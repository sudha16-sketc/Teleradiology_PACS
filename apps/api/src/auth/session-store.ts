import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { SESSION_COOKIE, JWT_ISSUER, JWT_AUDIENCE, JWT_ALGORITHM } from './auth.constants.js';

const REVOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * In-process session revocation used to invalidate stateless JWTs.
 *
 * Every issued token carries a `jti`. Login records the `jti` for the owning
 * user; logout (and, in future, password change / suspension flows) marks
 * tokens revoked. The AuthGuard refuses any revoked `jti`.
 *
 * This is a single-process store with the same deployment assumption as the
 * in-process rate limiter: one API replica. Multi-replica deployments need an
 * external store (e.g. Redis) to share revocations.
 */
export class SessionRevocationStore {
  private readonly revoked = new Map<string, number>();
  private readonly issuedByUser = new Map<string, Set<string>>();

  isRevoked(jti?: string): boolean {
    if (!jti) return false;
    const expiresAt = this.revoked.get(jti);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      this.revoked.delete(jti);
      return false;
    }
    return true;
  }

  register(jti: string, userId: string): void {
    let set = this.issuedByUser.get(userId);
    if (!set) {
      set = new Set<string>();
      this.issuedByUser.set(userId, set);
    }
    set.add(jti);
  }

  revoke(jti?: string): void {
    if (!jti) return;
    this.revoked.set(jti, Date.now() + REVOCATION_TTL_MS);
  }

  revokeAllForUser(userId: string): void {
    const set = this.issuedByUser.get(userId);
    if (!set) return;
    const expiresAt = Date.now() + REVOCATION_TTL_MS;
    for (const jti of set) this.revoked.set(jti, expiresAt);
  }

  /**
   * Decode the session token from a request cookie and revoke it. Used by the
   * logout flow which is deliberately @Public (no guard runs).
   */
  revokeFromResponse(response: Response): boolean {
    const token = (response.req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
    if (!token) return false;
    let payload: { jti?: string } | null = null;
    try {
      payload = jwt.decode(token) as { jti?: string } | null;
    } catch {
      payload = null;
    }
    this.revoke(payload?.jti);
    return true;
  }
}

export const sessionRevocationStore = new SessionRevocationStore();

/** Pinned verification options: exact algorithm and trustable issuer/audience. */
export function jwtVerifyOptions(): jwt.VerifyOptions {
  return {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };
}