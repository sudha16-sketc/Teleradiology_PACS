import type { User } from './user.js';
import type { Study } from './study.js';

export type ReportStatus = 'DRAFT' | 'SIGNED' | 'MANAGER_REVIEW' | 'MANAGER_APPROVED' | 'HOSPITAL_REVIEW' | 'CORRECTION_REQUESTED';

export interface Report {
  id: string;
  studyInstanceUid?: string;
  study?: Study;
  author: User;
  authorId: string;
  status: ReportStatus;
  version: number;
  clinicalHistory?: string;
  findings: string;
  impression: string;
  technique?: string;
  comparison?: string;
  recommendations?: string;
  criticalFinding: boolean;
  criticalFindingAcknowledged: boolean;
  criticalFindingAcknowledgedBy?: string;
  criticalFindingAcknowledgedAt?: string;
  signedOffBy?: string;
  signedOffAt?: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportVersion {
  id: string;
  reportId: string;
  version: number;
  status: ReportStatus;
  clinicalHistory?: string;
  findings: string;
  impression: string;
  technique?: string;
  comparison?: string;
  recommendations?: string;
  authorId: string;
  author?: User;
  contentHash: string;
  createdAt: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  modality?: string;
  subspecialty?: string;
  bodyPart?: string;
  template: string;
  isActive: boolean;
}
