import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { StudiesModule } from './studies/studies.module.js';
import { WorklistModule } from './worklist/worklist.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { UsersModule } from './users/users.module.js';
import { HospitalsModule } from './hospitals/hospitals.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AIModule } from './ai/ai.module.js';
import { DicomWebModule } from './dicomweb/dicomweb.module.js';
import { DicomModule } from './dicom/dicom.module.js';
import { CorrectionsModule } from './corrections/corrections.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { HealthModule } from './health/health.module.js';
import { SlaModule } from './sla/sla.module.js';
import { BackupModule } from './backup/backup.module.js';
import { RetentionModule } from './retention/retention.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    StudiesModule,
    WorklistModule,
    ReportsModule,
    ReviewsModule,
    UsersModule,
    HospitalsModule,
    AuditModule,
    AnalyticsModule,
    AIModule,
    DicomWebModule,
    DicomModule,
    CorrectionsModule,
    NotificationsModule,
    HealthModule,
    SlaModule,
    BackupModule,
    RetentionModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}