import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { PasswordResetEmailService } from './password-reset-email.service.js';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitService, PasswordResetEmailService],
  exports: [AuthService, AuthRateLimitService],
})
export class AuthModule {}