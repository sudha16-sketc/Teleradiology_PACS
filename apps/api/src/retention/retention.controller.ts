import { Controller, Get, Post } from '@nestjs/common';
import { RetentionService } from './retention.service.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';

interface RequestUser {
  id: string;
  role: string;
  displayName?: string;
}

@Controller('admin/retention')
@Roles('ADMIN')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  /** Dry-run: which COMPLETED studies are eligible for archival. */
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
