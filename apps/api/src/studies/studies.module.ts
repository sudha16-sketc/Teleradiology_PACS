import { Module } from '@nestjs/common';
import { StudiesController } from './studies.controller.js';
import { StudiesService } from './studies.service.js';

@Module({
  controllers: [StudiesController],
  providers: [StudiesService],
  exports: [StudiesService],
})
export class StudiesModule {}
