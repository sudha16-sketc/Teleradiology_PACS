-- Pre-deployment verification fixes (audit coverage).
--
-- USER_DELETED records user-administration removals, and LOGIN_FAILURE records
-- rejected authentication attempts against a known account, so the audit trail
-- covers the full user lifecycle plus failed sign-in (HIPAA 164.312(b)).
ALTER TYPE "AuditAction" ADD VALUE 'USER_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_FAILURE';
