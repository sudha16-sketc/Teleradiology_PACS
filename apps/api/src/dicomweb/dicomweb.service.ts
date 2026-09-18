import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Request, Response } from 'express';

/**
 * Explicit allow-list for DICOMweb operations that are NOT scoped to a study.
 * Study-scoped routes (containing /studies/<uid>) are authorized per-role;
 * everything else must match this list AND be requested by a global role
 * (ADMIN/MANAGER). Currently the only permitted unscoped operation is
 * QIDO-RS study-level listing (GET /studies).
 */
const GLOBAL_OPERATION_PATHS = /^\/studies\/?$/;

// Request headers the proxy is willing to forward upstream. Everything else
// (incl. client-supplied Authorization, cookies, X-Forwarded-*, origin,
// referer, ...) is never forwarded to Orthanc (D6).
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-encoding',
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
  'content-length',
  'content-encoding',
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

export type DicomWebUser = { id: string; role: UserRole };

@Injectable()
export class DicomWebService {
  constructor(private readonly prisma: PrismaService) {}

  orthancUrl(): string {
    return (process.env.ORTHANC_URL ?? 'http://localhost:8042').replace(/\/+$/, '');
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
  ): Promise<void> {
    const studyUid = this.extractStudyInstanceUid(pathname);

    // Paths that do not reference a study are NOT silently open. Only a tiny
    // geographic allow-list of unscoped operations (e.g. QIDO study list) is
    // reachable, and only by global roles.
    if (!studyUid) {
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

    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      select: { hospitalId: true, assignedRadiologistId: true },
    });
    if (!study) {
      throw new NotFoundException(
        `Study ${studyUid} is not indexed and cannot be accessed through DICOMweb`,
      );
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      // Global operational access (intended Phase 3 policy).
      return;
    }

    if (user.role === UserRole.RADIOLOGIST) {
      if (study.assignedRadiologistId === user.id) return;
      throw new ForbiddenException(
        'You do not have access to studies not assigned to you',
      );
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
    if (study.hospitalId !== axisUser.hospitalId) {
      throw new ForbiddenException(
        'You do not have access to studies from this hospital',
      );
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
    // Study-scoped or unscoped access is authorized before any proxying.
    await this.authorizeStudyAccess(authenticated.user, pathname, method);

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

    const timeoutMs = envInt('AXIS_ORTHANC_TIMEOUT_MS', 30000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let upstream: Awaited<ReturnType<typeof fetch>>;
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
    } catch (err) {
      clearTimeout(timer);
      const timedOut = (err as Error)?.name === 'AbortError';
      this.sendError(response, timedOut ? 504 : 503, request.url, timedOut);
      return;
    } finally {
      clearTimeout(timer);
    }

    // On non-success responses, do NOT stream Orthanc's error body verbatim:
    // it can contain internal endpoint/path details (C27). Send a sanitized,
    // stable JSON payload instead.
    if (upstream.status >= 400) {
      if (upstream.body) await upstream.body.cancel().catch(() => undefined);
      response.removeHeader('content-length');
      response.removeHeader('transfer-encoding');
      this.sendError(response, upstream.status, request.url, false);
      return;
    }

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
      nodeStream.pipe(response);
    } else {
      response.end();
    }
  }

  private sendError(
    response: Response,
    status: number,
    requestUrl: string,
    timedOut: boolean,
  ) {
    response.status(status).json({
      statusCode: status,
      message: timedOut
        ? 'The imaging backend timed out'
        : 'The imaging backend could not fulfil the DICOMweb request',
      error: status >= 500 ? 'Imaging Backend Error' : 'Imaging Backend Error',
      timestamp: new Date().toISOString(),
      path: requestUrl,
    });
  }
}