import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const actor = user || { id: 'system', displayName: 'System', role: 'SYSTEM' };
        this.prisma.auditLog.create({
          data: {
            actorId: actor.id,
            actorName: actor.displayName,
            actorRole: actor.role,
            action: 'STUDY_STATUS_CHANGED',
            resource: 'STUDY',
            resourceId: body?.studyInstanceUid || url,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] || '',
            metadata: { method, url },
          },
        }).catch(() => {});
      }),
    );
  }
}
