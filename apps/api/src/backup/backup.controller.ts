import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { BackupService } from './backup.service.js';
import { StartBackupDto } from './dto/start-backup.dto.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';

interface RequestUser {
  id: string;
  role: string;
  displayName?: string;
}

@Controller('admin/backups')
@Roles('ADMIN')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  list() {
    return this.backup.list();
  }

  @Post()
  run(@Body() dto: StartBackupDto, @CurrentUser() user: RequestUser) {
    return this.backup.run(dto.type, user);
  }

  @Post(':id/verify')
  verify(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.backup.verify(id, user);
  }
}
