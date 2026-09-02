import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { StudiesModule } from './studies/studies.module.js';
import { WorklistModule } from './worklist/worklist.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { UsersModule } from './users/users.module.js';
import { HospitalsModule } from './hospitals/hospitals.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AIModule } from './ai/ai.module.js';
import { DicomWebModule } from './dicomweb/dicomweb.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    StudiesModule,
    WorklistModule,
    ReportsModule,
    UsersModule,
    HospitalsModule,
    AuditModule,
    AnalyticsModule,
    AIModule,
    DicomWebModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}