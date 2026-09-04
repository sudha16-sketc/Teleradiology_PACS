import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Request, Response } from 'express';

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

  private extractStudyInstanceUid(path: string): string | undefined {
    const match = path.match(/\/studies\/([^/?#]+)/);
    if (!match) return undefined;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
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
    user: { id: string; role: UserRole },
    path: string,
  ): Promise<void> {
    const studyUid = this.extractStudyInstanceUid(path);
    // Paths that do not reference a study (e.g. /patients, /series) are not
    // study-scoped and pass through; study-scoped access is enforced on routes
    // that carry a study UID.
    if (!studyUid) return;

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
    const path = this.extractDicomwebPath(request);
    const target = `${this.dicomwebBase()}${path}`;

    const authenticated = request as Request & { user?: { id: string; role: UserRole } };
    if (authenticated.user) {
      await this.authorizeStudyAccess(authenticated.user, path);
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower === 'host') continue;
      if (lower === 'cookie') continue;
      if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      } else if (value !== undefined) {
        headers[key] = value;
      }
    }

    const orthancAuth = this.upstreamAuthHeader();
    if (orthancAuth) headers.authorization = orthancAuth;

    const hasBody = method !== 'GET' && method !== 'HEAD';

    const upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? (request as unknown as ReadableStream<Uint8Array>) : undefined,
      duplex: hasBody ? 'half' : undefined,
    } as RequestInit);

    response.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
      response.setHeader(key, value);
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
}