export interface ApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
  /**
   * The request correlation ID. Set by `CorrelationMiddleware` and echoed in
   * the `x-request-id` response header, so a user can quote one value and have
   * it matched to an API log line and an audit entry.
   */
  correlationId?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}
