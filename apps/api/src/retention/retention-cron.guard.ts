import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { RETENTION_CRON_HEADER, retentionCronSecret } from './retention-config.js';

@Injectable()
export class RetentionCronGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = retentionCronSecret();
    if (!expected) {
      throw new UnauthorizedException('Invalid cron secret');
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = request.headers[RETENTION_CRON_HEADER];
    if (typeof provided !== 'string' || !provided) {
      throw new UnauthorizedException('Invalid cron secret');
    }

    const expectedDigest = createHash('sha256').update(expected).digest();
    const providedDigest = createHash('sha256').update(provided).digest();
    if (!timingSafeEqual(expectedDigest, providedDigest)) {
      throw new UnauthorizedException('Invalid cron secret');
    }
    return true;
  }
}
