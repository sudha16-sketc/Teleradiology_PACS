import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import { CompanyService } from './company.service.js';
import { UpdateCompanySettingsDto } from './company.dto.js';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('company-settings')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  /**
   * Any authenticated user may read the organization profile because it is
   * rendered into every report footer. Only administrators/managers can change
   * it.
   */
  @Get()
  get() {
    return this.companyService.get();
  }

  @Put()
  @Roles('ADMIN', 'MANAGER')
  update(
    @Body() dto: UpdateCompanySettingsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companyService.update(dto, user.id);
  }
}
