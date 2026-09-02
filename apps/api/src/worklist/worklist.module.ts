import { Module } from '@nestjs/common';
import { WorklistController } from './worklist.controller.js';
import { WorklistService } from './worklist.service.js';
import { StudiesModule } from '../studies/studies.module.js';

@Module({
  imports: [StudiesModule],
  controllers: [WorklistController],
  providers: [WorklistService],
})
export class WorklistModule {}
