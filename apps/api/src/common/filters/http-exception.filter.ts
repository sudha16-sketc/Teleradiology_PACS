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
import { getCorrelationId } from '../observability/correlation.middleware.js';
import { log } from '../observability/structured-logger.js';

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
        path: request?.url,
        actorId: (request as { user?: { id?: string } })?.user?.id,
        error: (exception as Error)?.message,
        stack: (exception as Error)?.stack,
      });
    }

    const errorResponse: ApiError & { correlationId?: string } = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    if (correlationId) errorResponse.correlationId = correlationId;

    // Log a structured record for every handled error at an appropriate level.
    log(status >= 500 ? 'error' : 'warn', 'http_error', {
      correlationId,
      method: request?.method,
      path: request?.url,
      status,
      message,
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
