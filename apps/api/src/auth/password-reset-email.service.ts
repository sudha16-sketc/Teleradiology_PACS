import { Injectable } from '@nestjs/common';

@Injectable()
export class PasswordResetEmailService {
  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new Error('Password reset email is not configured');
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const resetUrl = new URL('/reset-password', baseUrl);
    resetUrl.searchParams.set('token', token);
    const expiresMinutes = process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? '20';

    const result = await fetch('https://api.resend.com/emails', {
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
        html: `<p>Use the link below to reset your Axis password. It expires in ${expiresMinutes} minutes.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
      }),
    });

    if (!result.ok) {
      throw new Error(`Password reset email provider returned HTTP ${result.status}`);
    }
  }
}
