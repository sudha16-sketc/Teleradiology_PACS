import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '@axis/types';
import {
  getCorrelationId,
  safeRoutePath,
} from '../observability/correlation.middleware.js';
import { log } from '../observability/structured-logger.js';

function safeStackFrames(exception: unknown): string | undefined {
  if (!(exception instanceof Error) || !exception.stack) return undefined;
  const frames = exception.stack
    .split(/\r?\n/)
    .filter((line) => /^\s*at\s/.test(line) || /^[^\s]+@/.test(line))
    .slice(0, 40)
    .join('\n');
  return frames ? frames.slice(0, 4000) : undefined;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();
    const correlationId = getCorrelationId(request);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object') {
        const obj = exResponse as Record<string, unknown>;
        const msg = obj.message;
        message = Array.isArray(msg) ? msg.join(', ') : (msg as string) || message;
        error = (obj.error as string) || error;
      }
    } else {
      // Non-HTTP (unexpected) errors: never expose internals to the client.
      message = 'Internal server error';
      error = 'Internal Server Error';
      log('error', 'unhandled_exception', {
        correlationId,
        method: request?.method,
        path: safeRoutePath(request),
        actorId: (request as { user?: { id?: string } })?.user?.id,
        errorType:
          exception instanceof Error
            ? exception.constructor.name
            : typeof exception,
        stack: safeStackFrames(exception),
      });
    }

    const errorResponse: ApiError & { correlationId?: string } = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: safeRoutePath(request),
    };
    if (correlationId) errorResponse.correlationId = correlationId;

    // Log a structured record for every handled error at an appropriate level.
    log(status >= 500 ? 'error' : 'warn', 'http_error', {
      correlationId,
      method: request?.method,
      path: safeRoutePath(request),
      status,
      errorType:
        exception instanceof Error
          ? exception.constructor.name
          : typeof exception,
      actorId: (request as { user?: { id?: string } })?.user?.id,
    });

    response.status(status).json(errorResponse);
  }
}

/**
 * Converts an underlying dependency failure (e.g. Orthanc) into a stable 503
 * response without leaking internal connection details. Exported for reuse.
 */
export function dependencyUnavailable(detail: string): ServiceUnavailableException {
  return new ServiceUnavailableException(detail);
}
