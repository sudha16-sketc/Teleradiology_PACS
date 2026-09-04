import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { StudyStatus } from '@axis/types';

export class UpdateStudyStatusDto {
  @IsEnum(['HOSPITAL_SUBMITTED', 'RECEIVING', 'VALIDATING', 'UNASSIGNED', 'ASSIGNED', 'IN_READING', 'REPORT_DRAFT', 'RADIOLOGIST_SIGNED', 'MANAGER_REVIEW', 'MANAGER_APPROVED', 'DELIVERED_TO_HOSPITAL', 'HOSPITAL_REVIEW', 'HOSPITAL_ACCEPTED', 'COMPLETED', 'CORRECTION_REQUESTED', 'HOSPITAL_CHANGE_REQUESTED', 'CANCELLED'] as const)
  status!: StudyStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
