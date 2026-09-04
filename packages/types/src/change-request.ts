import type { StudyStatus } from './study.js';
import type { Report } from './report.js';
import type { User } from './user.js';

export type ChangeRequestStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * A correction / change request for a signed report. The original signed
 * report/version is immutable; a correction creates a NEW version through the
 * normal reporting + review/delivery lifecycle.
 */
export interface ChangeRequest {
  id: string;
  studyId: string;
  reportId: string;
  requestedById: string;
  requestedByRole: string;
  assignedToId: string;
  reason: string;
  comment: string;
  status: ChangeRequestStatus;
  sourceStatus?: StudyStatus | null;
  parentReportVersionId?: string | null;
  newReportVersionId?: string | null;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  resolution?: string | null;
  createdAt: string;
  resolvedAt?: string | null;

  study?: {
    id: string;
    studyInstanceUid: string;
    accessionNumber: string;
    status: StudyStatus;
    modality: string;
    bodyPart: string;
    hospitalId: string;
    patient?: {
      displayName: string;
      patientId: string;
    } | null;
    hospital?: {
      id: string;
      name: string;
      code: string;
    } | null;
  } | null;
  report?: Report | null;
  requestedBy?: Partial<User> | null;
  assignedTo?: Partial<User> | null;
  reviewedBy?: Partial<User> | null;
  parentReportVersion?: { id: string; version: number; contentHash: string } | null;
  newReportVersion?: { id: string; version: number; contentHash: string } | null;
}
