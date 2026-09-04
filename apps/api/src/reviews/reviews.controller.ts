import { Controller, Post, Param } from '@nestjs/common';
import { ReviewsService } from './reviews.service.js';
import { Roles, CurrentUser } from '../auth/auth.decorators.js';
import type { UserRole } from '@prisma/client';

interface RequestUser {
  id: string;
  role: UserRole;
  hospitalId?: string;
  displayName?: string;
}

/**
 * Phase 5 — Review & Hospital Delivery endpoints.
 *
 * Each action is guarded by @Roles AND server-side prerequisite validation in
 * ReviewsService. The generic PATCH /studies/:uid/status endpoint is hardened
 * independently so it cannot bypass these role-specific operations.
 */
@Controller('studies')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post(':studyUid/review')
  @Roles('ADMIN', 'MANAGER')
  review(@Param('studyUid') studyUid: string, @CurrentUser() user: RequestUser) {
    return this.reviewsService.review(studyUid, user);
  }

  @Post(':studyUid/approve')
  @Roles('ADMIN', 'MANAGER')
  approve(@Param('studyUid') studyUid: string, @CurrentUser() user: RequestUser) {
    return this.reviewsService.approve(studyUid, user);
  }

  @Post(':studyUid/deliver')
  @Roles('ADMIN', 'MANAGER')
  deliver(@Param('studyUid') studyUid: string, @CurrentUser() user: RequestUser) {
    return this.reviewsService.deliver(studyUid, user);
  }

  @Post(':studyUid/hospital-review')
  @Roles('HOSPITAL')
  hospitalReview(
    @Param('studyUid') studyUid: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reviewsService.hospitalReview(studyUid, user);
  }

  @Post(':studyUid/accept')
  @Roles('HOSPITAL')
  accept(@Param('studyUid') studyUid: string, @CurrentUser() user: RequestUser) {
    return this.reviewsService.accept(studyUid, user);
  }

  @Post(':studyUid/complete')
  @Roles('ADMIN', 'MANAGER')
  complete(@Param('studyUid') studyUid: string, @CurrentUser() user: RequestUser) {
    return this.reviewsService.complete(studyUid, user);
  }
}
