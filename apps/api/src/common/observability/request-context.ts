import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  correlationId?: string;
}

/**
 * Per-request AsyncLocalStorage store. The correlation middleware runs each
 * request inside this context so downstream async code (services, audit writes)
 * can read the current correlation ID without threading it through every call.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}
