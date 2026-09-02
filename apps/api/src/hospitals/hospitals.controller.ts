import { Controller, Get, Param } from '@nestjs/common';
import { HospitalsService } from './hospitals.service.js';

@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  list() {
    return this.hospitalsService.list();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.hospitalsService.getOne(id);
  }
}
