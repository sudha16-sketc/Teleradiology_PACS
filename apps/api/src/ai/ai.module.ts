import { Module } from '@nestjs/common';
import { AIController } from './ai.controller.js';
import { AIService } from './ai.service.js';

@Module({
  controllers: [AIController],
  providers: [AIService],
})
export class AIModule {}
