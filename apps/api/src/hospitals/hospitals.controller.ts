import { Controller, Get, Param, ForbiddenException } from '@nestjs/common';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import { HospitalsService } from './hospitals.service.js';

interface RequestUser {
  id: string;
  role: string;
  hospitalId?: string | null;
}

@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  /**
   * Full hospital list. Restricted to ADMIN/MANAGER — HOSPITAL users must
   * never see other hospitals, so they are not permitted on this route at all.
   */
  @Get()
  @Roles('ADMIN', 'MANAGER')
  list() {
    return this.hospitalsService.list();
  }

  /**
   * Single hospital by id.
   *   - ADMIN / MANAGER: may look up any hospital by id.
   *   - HOSPITAL: may only look up their OWN hospital. The id in the URL is
   *     checked against the logged-in user's own hospitalId; any mismatch is
   *     rejected, even if the hospital itself exists, so a hospital user can
   *     never view another hospital's data by guessing/changing the id.
   */
  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'HOSPITAL')
  getOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    if (user.role === 'HOSPITAL' && user.hospitalId !== id) {
      throw new ForbiddenException('You can only access your own hospital');
    }
    return this.hospitalsService.getOne(id);
  }
}