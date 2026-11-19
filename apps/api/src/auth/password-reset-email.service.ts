import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isProduction } from '../common/config/env-validation.js';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const EMAIL_REQUEST_TIMEOUT_MS = 10000;
const OUTAGE_COOLDOWN_MS = 30000;
const SENDER_PATTERN = /^(?:[^<>\s]+(?:\s+[^<>\s]+)*\s*)?<([^\s<>@]+@[^\s<>@]+)>$|^[^\s<>@]+@[^\s<>@]+$/;

/**
 * Validates delivery configuration without ever returning a secret value. The
 * message is safe to show to a signed-out user and specific enough to tell an
 * administrator what needs fixing.
 */
export function passwordResetConfigurationIssue(): string | null {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  const from = process.env.EMAIL_FROM?.trim() ?? '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? '';

  if (!apiKey) return 'Password reset email delivery is not configured';
  if (/^(your[_-]?|replace[_-]?|example[_-]?)/i.test(apiKey)) {
    return 'Password reset email provider credentials are not configured';
  }
  if (!SENDER_PATTERN.test(from)) {
    return 'Password reset sender address is not configured correctly';
  }
  if (!appUrl) return 'Password reset link destination is not configured';

  try {
    const parsed = new URL(appUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'Password reset link destination is not configured correctly';
    }
    if (isProduction() && parsed.protocol === 'http:' && parsed.hostname !== 'localhost') {
      return 'Password reset link destination must use HTTPS';
    }
  } catch {
    return 'Password reset link destination is not configured correctly';
  }
  return null;
}

@Injectable()
export class PasswordResetEmailService {
  private unavailableUntil = 0;

  isConfigured(): boolean {
    return passwordResetConfigurationIssue() === null;
  }

  assertConfigured(): void {
    const issue = passwordResetConfigurationIssue();
    if (issue) {
      throw new ServiceUnavailableException(issue);
    }
  }

  assertDeliveryAvailable(): void {
    if (Date.now() < this.unavailableUntil) {
      throw new ServiceUnavailableException(
        'Password reset email delivery is temporarily unavailable',
      );
    }
  }

  private markUnavailable(): void {
    this.unavailableUntil = Date.now() + OUTAGE_COOLDOWN_MS;
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    this.assertConfigured();
    this.assertDeliveryAvailable();
    const apiKey = process.env.RESEND_API_KEY as string;
    const from = process.env.EMAIL_FROM as string;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL as string;
    const resetUrl = new URL('/reset-password', baseUrl);
    resetUrl.searchParams.set('token', token);
    const expiresMinutes = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 20);
    const safeResetUrl = resetUrl.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;');

    try {
      const result = await fetch(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: 'Reset your Axis password',
          text: `Use this link to reset your Axis password. It expires in ${expiresMinutes} minutes:\n\n${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`,
          html: `<p>Use the link below to reset your Axis password. It expires in ${expiresMinutes} minutes.</p><p><a href="${safeResetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
        }),
        signal: AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS),
      });

      if (!result.ok) {
        throw new Error(`Password reset email provider returned HTTP ${result.status}`);
      }
    } catch (error) {
      this.markUnavailable();
      const detail = error instanceof Error ? error.message : 'Unknown email delivery error';
      throw new ServiceUnavailableException(
        `Password reset email could not be delivered: ${detail}`,
      );
    }
  }
}
