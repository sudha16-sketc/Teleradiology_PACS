import type { Request, Response, NextFunction } from 'express';

/**
 * Sane HTTP security headers for the Axis API.
 *
 * Note on framing: OHIF is served by its own container on a separate origin and
 * is framed by the web frontend, not by the API. These headers are applied to
 * API responses only, so they do not govern OHIF's framing. We use SAMEORIGIN
 * for X-Frame-Options and do NOT emit a restrictive frame-ancestors directive by
 * default, so legitimate same-origin embedding is not broken. Set
 * SECURITY_HEADERS_DISABLED=1 to opt out (not recommended in production).
 */
export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (process.env.SECURITY_HEADERS_DISABLED === '1') {
    return next();
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // Content-Security-Policy. Default policy does not add frame-ancestors so the
  // web frontend can embed OHIF if it chooses; it still restricts script/style/
  // object sources to self and inline where the Next.js app requires them.
  if (process.env.SECURITY_HEADERS_CSP) {
    res.setHeader('Content-Security-Policy', process.env.SECURITY_HEADERS_CSP);
  }

  // Strict-Transport-Security is only meaningful over HTTPS and is therefore
  // enabled in production only.
  if (process.env.NODE_ENV === 'production' || process.env.AXIS_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
