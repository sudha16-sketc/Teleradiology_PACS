import { Controller, Get, Post } from '@nestjs/common';
import { RetentionService } from './retention.service.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';

interface RequestUser {
  id: string;
  role: string;
  displayName?: string;
  email?: string;
  hospitalId?: string | null;
}

@Controller('admin/retention')
@Roles('ADMIN', 'MANAGER')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  /** Dry-run: retention policy, reviewed studies, eligibility, and skip reasons. */
  @Get('preview')
  preview(@CurrentUser() user: RequestUser) {
    return this.retention.preview(user);
  }

  /** Mark eligible studies as archived (data remains; audit recorded per study). */
  @Post('execute')
  execute(@CurrentUser() user: RequestUser) {
    return this.retention.execute(user);
  }
}
