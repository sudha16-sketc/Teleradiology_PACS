import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  MethodNotAllowedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { orthancBaseUrl } from '../common/config/orthanc-url.js';
import { getCorrelationId } from '../common/observability/correlation.middleware.js';
import { log } from '../common/observability/structured-logger.js';
import { safeRequestPath } from '../common/observability/safe-path.js';
import { AuditService } from '../audit/audit.service.js';
import { isValidDicomUid } from '../dicom/dicom.constants.js';
import type { ImagingAvailability, ImagingAvailabilityResult } from '@axis/types';
import type { Request, Response } from 'express';
import type { StoredSession } from '../redis/redis-session.service.js';

/**
 * Explicit allow-list for DICOMweb operations that are NOT scoped to a study.
 * Study-scoped routes (containing /studies/<uid>) are authorized per-role;
 * everything else must match this list AND be requested by a global role
 * (ADMIN/MANAGER). Currently the only permitted unscoped operation is
 * QIDO-RS study-level listing (GET /studies).
 */
const GLOBAL_OPERATION_PATHS = /^\/studies\/?$/;

// QIDO-RS identity keys. A study/series identity filter in the query string is
// equivalent to a study-scoped path for authorization purposes: the result set
// Orthanc returns is confined to the referenced instance, so the caller must
// pass exactly the same checks as /studies/<uid>/... (A6).
const STUDY_UID_QUERY_KEYS = ['StudyInstanceUID'];
const SERIES_UID_QUERY_KEYS = ['SeriesInstanceUID'];

// Only read operations may derive study scope from a query filter. A filter on a
// mutating request (STOW/DELETE/...) would otherwise hand a radiologist an
// upstream write they were previously denied, since the unscoped allow-list is
// GET-only.
const SCOPE_FROM_QUERY_METHODS = new Set(['GET', 'HEAD']);

// Request headers the proxy is willing to forward upstream. Everything else
// (incl. client-supplied Authorization, cookies, X-Forwarded-*, origin,
// referer, ...) is never forwarded to Orthanc (D6).
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'content-encoding',
  'range',
  'if-range',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
];

// Response headers worth copying back to the client. Set-Cookie from Orthanc
// is never echoed, and hop-by-hop headers are always stripped (D6).
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'transfer-syntax',
  'content-disposition',
  'accept-ranges',
  'content-range',
  'range',
  'last-modified',
  'etag',
  'cache-control',
  'expires',
  'vary',
];

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type DicomWebUser = { id: string; role: UserRole; hospitalId?: string | null };

type DicomJsonElement = { Value?: unknown[] };

function dicomJsonUid(item: unknown, tag: string): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const element = (item as Record<string, unknown>)[tag] as DicomJsonElement | undefined;
  const value = element?.Value?.[0];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeUid(uid: string | null | undefined): string {
  return (uid ?? '').replace(/[\u0000\s]+/g, '');
}

@Injectable()
export class DicomWebService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  orthancUrl(): string {
    return orthancBaseUrl();
  }

  private dicomwebBase(): string {
    return `${this.orthancUrl()}/dicom-web`;
  }

  private upstreamAuthHeader(): string | undefined {
    const username = process.env.ORTHANC_USERNAME;
    const password = process.env.ORTHANC_PASSWORD;
    if (!username || !password) return undefined;
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  /**
   * Extracts the DICOMweb sub-path from an incoming request, e.g.
   *   /api/dicom-web/studies/1.2.3?foo=bar  ->  /studies/1.2.3?foo=bar
   */
  private extractDicomwebPath(request: Request): string {
    const original = request.originalUrl ?? request.url ?? '';
    const prefix = '/api/dicom-web';
    if (original.startsWith(prefix)) {
      return original.slice(prefix.length) || '/';
    }
    const marker = original.indexOf('/dicom-web');
    if (marker !== -1) {
      return original.slice(marker + '/dicom-web'.length) || '/';
    }
    return original;
  }

  /**
   * Normalizes and validates the DICOMweb sub-path. Traversal ("..") is
   * rejected BEFORE the path is appended to the upstream base URL: URL
   * normalizers collapse "..", so without this guard a request like
   * /dicom-web/../../patients would escape the /dicom-web root and reach the
   * raw Orthanc REST API (A1).
   */
  private assertSafePath(path: string): { pathname: string; query: string } {
    if (!path.startsWith('/')) {
      throw new BadRequestException('Malformed DICOMweb path');
    }
    const pathname = path.split('?')[0];
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new BadRequestException('Malformed DICOMweb path encoding');
    }
    if (decoded.split('/').some((segment) => segment === '..')) {
      throw new BadRequestException(
        'DICOMweb path may not contain traversal segments',
      );
    }
    const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
    return { pathname, query };
  }

  private extractStudyInstanceUid(pathname: string): string | undefined {
    const match = pathname.match(/\/studies\/([^/?#]+)/);
    if (!match) return undefined;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  /**
   * Collects every value supplied for the given QIDO-RS identity keys.
   *
   * Keys are matched case-insensitively because Orthanc matches them that way:
   * matching only the exact spelling would let a differently-cased parameter
   * reach Orthanc as a genuine filter while skipping the check here (A6).
   * Multi-valued attributes arrive either as repeated parameters or as one
   * backslash/comma separated value, so all forms are collected.
   *
   * A wildcard is reported separately: "*"/"?" match every value, so such a
   * query is NOT confined to one instance and must stay unscoped rather than
   * being mistaken for a specific study.
   */
  private collectIdentityFilter(
    query: string,
    keys: readonly string[],
  ): { uids: string[]; wildcard: boolean } {
    const wanted = new Set(keys.map((key) => key.toLowerCase()));
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    const uids: string[] = [];
    let wildcard = false;
    for (const [key, value] of params.entries()) {
      if (!wanted.has(key.toLowerCase())) continue;
      for (const raw of value.split(/[\\,]/)) {
        const candidate = raw.trim();
        if (candidate === '') continue;
        if (candidate.includes('*') || candidate.includes('?')) {
          wildcard = true;
          continue;
        }
        uids.push(candidate);
      }
    }
    return { uids, wildcard };
  }

  /**
   * Maps SeriesInstanceUID filters onto the studies that own them so series
   * queries are subject to the same hospital/radiologist checks. A series that
   * is not indexed is REJECTED (404) exactly like an unindexed study, so an
   * unknown identifier can never bypass authorization.
   */
  private async resolveSeriesStudyUids(seriesUids: string[]): Promise<string[]> {
    const unique = [...new Set(seriesUids)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.series.findMany({
      where: { seriesInstanceUid: { in: unique } },
      select: {
        seriesInstanceUid: true,
        study: { select: { studyInstanceUid: true } },
      },
    });
    const owning = new Map(
      rows.map((row) => [row.seriesInstanceUid, row.study.studyInstanceUid]),
    );
    const missing = unique.filter((uid) => !owning.has(uid));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Series ${missing[0]} is not indexed and cannot be accessed through DICOMweb`,
      );
    }
    return unique.map((uid) => owning.get(uid) as string);
  }

  private isAllowedUnscopedOperation(method: string, pathname: string): boolean {
    // GET only: QIDO-RS study-level listing.
    if (method !== 'GET') return false;
    return GLOBAL_OPERATION_PATHS.test(pathname);
  }

  /**
   * Study-level DICOMweb authorization (Phase 3 rules):
   * - ADMIN:   global DICOM access.
   * - MANAGER: global operational DICOM access.
   * - RADIOLOGIST: only studies assigned to them.
   * - HOSPITAL: only studies belonging to the authenticated hospital.
   *
   * Scope is always derived from the authenticated user; hospitalId /
   * radiologistId are NEVER trusted from the request path or payload.
   *
   * A StudyInstanceUID in the path that cannot be resolved to an Axis study
   * record is REJECTED (404) rather than silently allowed, so a missing Axis
   * study can never be used to bypass authorization.
   */
  async authorizeStudyAccess(
    user: DicomWebUser,
    pathname: string,
    method: string,
    query = '',
  ): Promise<void> {
    // Scope is derived from the path first, then from QIDO-RS identity
    // filters. Only read operations may take scope from the query (see
    // SCOPE_FROM_QUERY_METHODS).
    const scopedUids = new Set<string>();
    const pathStudyUid = this.extractStudyInstanceUid(pathname);
    if (pathStudyUid) scopedUids.add(pathStudyUid);

    if (SCOPE_FROM_QUERY_METHODS.has(method)) {
      const studyFilter = this.collectIdentityFilter(query, STUDY_UID_QUERY_KEYS);
      const seriesFilter = this.collectIdentityFilter(query, SERIES_UID_QUERY_KEYS);

      // A wildcard identity filter matches every value, so the result set is
      // not confined to any single study. Such a query keeps only the scope
      // proven by the path and otherwise falls through to the unscoped rules,
      // rather than gaining study scope from the wildcard.
      if (!studyFilter.wildcard && !seriesFilter.wildcard) {
        const seriesStudyUids = await this.resolveSeriesStudyUids(seriesFilter.uids);
        for (const uid of [...studyFilter.uids, ...seriesStudyUids]) {
          scopedUids.add(uid);
        }
      }
    }

    // Paths that do not reference a study are NOT silently open. Only a tiny
    // allow-list of unscoped operations (e.g. QIDO study list) is reachable,
    // and only by global roles.
    if (scopedUids.size === 0) {
      if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER) {
        throw new ForbiddenException(
          'You do not have access to unscoped DICOMweb operations',
        );
      }
      if (!this.isAllowedUnscopedOperation(method, pathname)) {
        throw new ForbiddenException(
          'This DICOMweb operation is not in the allowed list',
        );
      }
      return;
    }

    // EVERY referenced study must pass. Authorizing only the first value of a
    // repeated parameter would let a caller pair an accessible study with a
    // forbidden one and still have Orthanc return both.
    await this.assertStudiesAccessible(user, [...scopedUids]);
  }

  /**
   * Enforces the per-study Phase 3 rules for one or more studies, keeping the
   * original rejection semantics: an unindexed study is 404 for every role
   * (checked before the global-role shortcut), an inaccessible but indexed
   * study is 403.
   */
  private async assertStudiesAccessible(
    user: DicomWebUser,
    studyUids: string[],
  ): Promise<void> {
    const unique = [...new Set(studyUids)];
    const rows = await this.prisma.study.findMany({
      where: { studyInstanceUid: { in: unique } },
      select: {
        studyInstanceUid: true,
        hospitalId: true,
        assignedRadiologistId: true,
      },
    });
    const byUid = new Map(rows.map((row) => [row.studyInstanceUid, row]));

    const missing = unique.filter((uid) => !byUid.has(uid));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Study ${missing[0]} is not indexed and cannot be accessed through DICOMweb`,
      );
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      // Global operational access (intended Phase 3 policy).
      return;
    }

    if (user.role === UserRole.RADIOLOGIST) {
      for (const uid of unique) {
        if (byUid.get(uid)?.assignedRadiologistId === user.id) continue;
        throw new ForbiddenException(
          'You do not have access to studies not assigned to you',
        );
      }
      return;
    }

    // HOSPITAL (and any other non-admin/manager/non-radiologist role): scope to
    // the authenticated user's hospital only.
    const axisUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { hospitalId: true },
    });
    if (!axisUser?.hospitalId) {
      throw new ForbiddenException(
        'Your account is not linked to a hospital and cannot access study DICOM data',
      );
    }
    for (const uid of unique) {
      if (byUid.get(uid)?.hospitalId === axisUser.hospitalId) continue;
      throw new ForbiddenException(
        'You do not have access to studies from this hospital',
      );
    }
  }

  private async fetchDicomwebJson<T>(
    path: string,
  ): Promise<{ ok: true; body: T } | { ok: false; status?: number }> {
    const target = `${this.dicomwebBase()}${path}`;
    const auth = this.upstreamAuthHeader();
    const headers: Record<string, string> = {
      Accept: 'application/dicom+json',
      ...(auth ? { Authorization: auth } : {}),
    };
    const timeoutMs = envInt('AXIS_ORTHANC_TIMEOUT_MS', 30000);
    const attempts = 2;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let upstream: Awaited<ReturnType<typeof fetch>>;
      try {
        upstream = await fetch(target, { method: 'GET', headers, signal: controller.signal });
        clearTimeout(timer);
      } catch (err) {
        clearTimeout(timer);
        log('warn', 'dicomweb_availability_upstream_failure', {
          route: safeRequestPath(path),
          attempt,
          attempts,
          timeoutMs,
          timedOut: (err as Error)?.name === 'AbortError',
          errorName: (err as Error)?.name ?? 'UnknownError',
        });
        if (attempt === attempts) return { ok: false };
        continue;
      }

      if (!upstream.ok) {
        if (upstream.body) await upstream.body.cancel().catch(() => undefined);
        log('warn', 'dicomweb_availability_upstream_error', {
          route: safeRequestPath(path),
          upstreamStatus: upstream.status,
        });
        return { ok: false, status: upstream.status };
      }

      try {
        return { ok: true, body: (await upstream.json()) as T };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }

  async listOrthancStudyUids(maxStudies = 500): Promise<string[]> {
    const response = await this.fetchDicomwebJson<unknown>(
      `/studies?limit=${Math.max(1, Math.min(maxStudies, 5000))}`,
    );
    if (!response.ok || !Array.isArray(response.body)) return [];
    return response.body
      .map((item) => dicomJsonUid(item, '0020000D'))
      .filter((uid): uid is string => !!uid)
      .map(normalizeUid);
  }

  private async persistAvailability(
    studyId: string,
    result: ImagingAvailabilityResult,
    persist: boolean,
  ): Promise<ImagingAvailabilityResult> {
    if (!persist) return result;
    await this.prisma.study.update({
      where: { id: studyId },
      data: {
        imagingAvailability: result.state as ImagingAvailability,
        imagingAvailabilityReason: result.reason,
        imagingCheckedAt: new Date(result.checkedAt),
      },
    });
    return result;
  }

  async verifyStudyAvailability(
    user: DicomWebUser,
    studyUid: string,
    options: { persist?: boolean; audit?: boolean } = {},
  ): Promise<ImagingAvailabilityResult> {
    if (!isValidDicomUid(studyUid)) {
      throw new BadRequestException('Invalid StudyInstanceUID');
    }
    await this.authorizeStudyAccess(
      user,
      `/studies/${encodeURIComponent(studyUid)}`,
      'GET',
    );

    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      select: {
        id: true,
        seriesCount: true,
        instanceCount: true,
        series: { select: { seriesInstanceUid: true } },
        instances: { select: { sopInstanceUid: true } },
      },
    });
    if (!study) {
      throw new NotFoundException('Study not found');
    }

    const checkedAt = new Date().toISOString();
    const expectedSeriesUids = study.series
      .map((row) => normalizeUid(row.seriesInstanceUid))
      .filter(Boolean);
    const expectedInstanceUids = study.instances
      .map((row) => normalizeUid(row.sopInstanceUid))
      .filter(Boolean);
    const base = {
      studyInstanceUid: studyUid,
      checkedAt,
      expectedSeriesCount: expectedSeriesUids.length || study.seriesCount,
      expectedInstanceCount: expectedInstanceUids.length || study.instanceCount,
      actualSeriesCount: 0,
      actualInstanceCount: 0,
      missingSeriesUids: [] as string[],
      missingInstanceUids: [] as string[],
    };

    const result = async (
      state: ImagingAvailability,
      reason: string,
      actualSeriesCount = 0,
      actualInstanceCount = 0,
      missingSeriesUids: string[] = [],
      missingInstanceUids: string[] = [],
    ): Promise<ImagingAvailabilityResult> => {
      const value: ImagingAvailabilityResult = {
        ...base,
        state,
        reason,
        actualSeriesCount,
        actualInstanceCount,
        missingSeriesUids,
        missingInstanceUids,
      };
      const persisted = await this.persistAvailability(
        study.id,
        value,
        options.persist ?? true,
      );
      if (options.audit ?? true) {
        await this.audit.create({
          actorId: user.id,
          actorName: 'Imaging availability check',
          actorRole: user.role,
          action: 'DICOM_AVAILABILITY_CHECK',
          resource: 'STUDY',
          resourceId: study.id,
          metadata: { state, reason },
        }).catch(() => undefined);
      }
      return persisted;
    };

    const qido = await this.fetchDicomwebJson<unknown>(
      `/studies?StudyInstanceUID=${encodeURIComponent(studyUid)}`,
    );
    if (!qido.ok) {
      return result('UNAVAILABLE', 'The imaging service is temporarily unavailable');
    }
    if (!Array.isArray(qido.body)) {
      return result('UNAVAILABLE', 'The imaging service returned an unexpected response');
    }
    const matches = qido.body.filter(
      (item) => normalizeUid(dicomJsonUid(item, '0020000D')) === normalizeUid(studyUid),
    );
    if (matches.length === 0) {
      return result('MISSING', 'The study is not present in Orthanc');
    }
    if (matches.length > 1) {
      return result('INCOMPLETE', 'Orthanc reports more than one study with this StudyInstanceUID');
    }

    const seriesResponse = await this.fetchDicomwebJson<unknown>(
      `/studies/${encodeURIComponent(studyUid)}/series`,
    );
    if (!seriesResponse.ok || !Array.isArray(seriesResponse.body)) {
      return result('UNAVAILABLE', 'The imaging service is temporarily unavailable');
    }
    const actualSeriesUids = seriesResponse.body
      .map((item) => normalizeUid(dicomJsonUid(item, '0020000E')))
      .filter(Boolean);
    const actualInstanceUids: string[] = [];
    for (const seriesUid of actualSeriesUids) {
      const instances = await this.fetchDicomwebJson<unknown>(
        `/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUid)}/instances`,
      );
      if (!instances.ok || !Array.isArray(instances.body)) {
        return result('UNAVAILABLE', 'The imaging service is temporarily unavailable');
      }
      for (const item of instances.body) {
        const sopUid = normalizeUid(dicomJsonUid(item, '00080018'));
        if (sopUid) actualInstanceUids.push(sopUid);
      }
    }

    const missingSeries = expectedSeriesUids.filter((uid) => !actualSeriesUids.includes(uid));
    const missingInstances = expectedInstanceUids.filter(
      (uid) => !actualInstanceUids.includes(uid),
    );
    const uniqueInstances = [...new Set(actualInstanceUids)];

    if (actualSeriesUids.length === 0 || uniqueInstances.length === 0) {
      return result(
        'INCOMPLETE',
        'The study is indexed but has no retrievable series or instances',
        actualSeriesUids.length,
        uniqueInstances.length,
        missingSeries,
        missingInstances,
      );
    }
    if (missingSeries.length > 0 || missingInstances.length > 0) {
      return result(
        'INCOMPLETE',
        'The study is present in Orthanc but expected series or instances are missing',
        actualSeriesUids.length,
        uniqueInstances.length,
        missingSeries,
        missingInstances,
      );
    }
    if ((study.seriesCount > 0 && expectedSeriesUids.length === 0) ||
        (study.instanceCount > 0 && expectedInstanceUids.length === 0)) {
      return result(
        'INCOMPLETE',
        'Database counts exist without indexed series or instance identifiers; reconciliation required',
        actualSeriesUids.length,
        uniqueInstances.length,
      );
    }

    return result(
      'AVAILABLE',
      'Study, series, and instances verified in Orthanc',
      actualSeriesUids.length,
      uniqueInstances.length,
    );
  }

  /** Defense in depth for the imaging gateway: the route is already protected
   * by AuthGuard, and the DICOMweb path must belong to the same live session
   * and tenant as the PostgreSQL user used for study-level authorization. */
  assertGatewaySession(request: Request, user: DicomWebUser): void {
    const session = (request as Request & { session?: StoredSession }).session;
    if (
      !session ||
      session.userId !== user.id ||
      session.role !== user.role ||
      session.tenantId !== (user.hospitalId ?? null)
    ) {
      throw new UnauthorizedException('Session expired or invalid');
    }
  }

  async proxy(request: Request, method: string, response: Response) {
    const rawPath = this.extractDicomwebPath(request);
    const { pathname, query } = this.assertSafePath(rawPath);
    const path = `${pathname}${query}`;
    const target = `${this.dicomwebBase()}${path}`;

    const authenticated = request as Request & { user?: DicomWebUser };
    if (!authenticated.user) {
      throw new UnauthorizedException('Authentication required for DICOMweb');
    }
    this.assertGatewaySession(request, authenticated.user);
    if (method !== 'GET' && method !== 'HEAD') {
      throw new MethodNotAllowedException(
        'Only read DICOMweb operations are supported through this proxy',
      );
    }
    // Study-scoped or unscoped access is authorized before any proxying.
    // The query string is part of the authorization input: QIDO-RS identity
    // filters can scope a request just as well as a /studies/<uid> path.
    await this.authorizeStudyAccess(
      authenticated.user,
      pathname,
      method,
      query,
    );

    const headers: Record<string, string> = {};
    for (const key of FORWARD_REQUEST_HEADERS) {
      const value = request.headers[key];
      if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      } else if (value !== undefined) {
        headers[key] = value;
      }
    }
    const orthancAuth = this.upstreamAuthHeader();
    if (orthancAuth) headers.authorization = orthancAuth;

    const hasBody = method !== 'GET' && method !== 'HEAD';
    const retryable = !hasBody;
    const attempts = retryable ? 2 : 1;
    const timeoutMs = envInt('AXIS_ORTHANC_TIMEOUT_MS', 30000);
    const correlationId = getCorrelationId(request);
    const route = safeRequestPath(request.originalUrl ?? request.url);

    let upstream: Awaited<ReturnType<typeof fetch>> | undefined;
    let controller = new AbortController();
    let timedOut = false;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        upstream = await fetch(target, {
          method,
          headers,
          body: hasBody
            ? (request as unknown as ReadableStream<Uint8Array>)
            : undefined,
          duplex: hasBody ? 'half' : undefined,
          signal: controller.signal,
        } as RequestInit);
        clearTimeout(timer);
        break;
      } catch (err) {
        clearTimeout(timer);
        timedOut = (err as Error)?.name === 'AbortError';
        log('warn', 'dicomweb_upstream_failure', {
          correlationId,
          method,
          route,
          attempt,
          attempts,
          timeoutMs,
          timedOut,
          errorName: (err as Error)?.name ?? 'UnknownError',
        });
        if (attempt === attempts) {
          this.sendError(response, timedOut ? 504 : 503, route, timedOut, correlationId);
          return;
        }
      }
    }

    if (!upstream) {
      this.sendError(response, 503, route, false, correlationId);
      return;
    }

    // On non-success responses, do NOT stream Orthanc's error body verbatim:
    // it can contain internal endpoint/path details (C27). Keep the upstream
    // status in the server log, but never expose its body or URL to the client.
    if (upstream.status >= 400) {
      if (upstream.body) await upstream.body.cancel().catch(() => undefined);
      log('warn', 'dicomweb_upstream_error', {
        correlationId,
        method,
        route,
        upstreamStatus: upstream.status,
      });
      response.removeHeader('content-length');
      response.removeHeader('transfer-encoding');
      this.sendError(response, upstream.status, route, false, correlationId);
      return;
    }

    log('info', 'dicomweb_upstream_response', {
      correlationId,
      method,
      route,
      upstreamStatus: upstream.status,
    });

    response.status(upstream.status);
    for (const key of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(key);
      if (value !== null) response.setHeader(key, value);
    }

    if (upstream.body) {
      const { Readable } = await import('stream');
      const nodeStream = Readable.fromWeb(
        upstream.body as unknown as import('stream/web').ReadableStream,
      );
      const streamIdleTimeoutMs = envInt('AXIS_ORTHANC_STREAM_IDLE_TIMEOUT_MS', 60000);
      let streamTimer: ReturnType<typeof setTimeout> | undefined;
      const clearStreamTimer = () => {
        if (streamTimer) clearTimeout(streamTimer);
        streamTimer = undefined;
      };
      const armStreamTimer = () => {
        clearStreamTimer();
        streamTimer = setTimeout(() => {
          log('warn', 'dicomweb_stream_timeout', {
            correlationId,
            method,
            route,
            idleTimeoutMs: streamIdleTimeoutMs,
          });
          controller.abort();
        }, streamIdleTimeoutMs);
      };

      nodeStream.on('error', (err: Error) => {
        clearStreamTimer();
        log('error', 'dicomweb_stream_error', {
          correlationId,
          method,
          route,
          errorName: err?.name ?? 'UnknownError',
        });
        if (!response.writableEnded) response.destroy();
      });
      nodeStream.once('end', clearStreamTimer);
      response.once('close', () => {
        clearStreamTimer();
        if (!response.writableEnded) controller.abort();
      });

      armStreamTimer();
      nodeStream.pipe(response);
      nodeStream.on('data', armStreamTimer);
    } else {
      response.end();
    }
  }

  private sendError(
    response: Response,
    status: number,
    route: string,
    timedOut: boolean,
    correlationId?: string,
  ) {
    if (status >= 500) {
      response.setHeader('Retry-After', timedOut ? '2' : '5');
    }
    response.status(status).json({
      statusCode: status,
      message: timedOut
        ? 'The imaging backend timed out'
        : 'The imaging backend could not fulfil the DICOMweb request',
      error: 'Imaging Backend Error',
      timestamp: new Date().toISOString(),
      path: route,
      correlationId,
    });
  }
}