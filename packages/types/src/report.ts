import type { User } from './user.js';
import type { Study } from './study.js';

export type ReportStatus = 'DRAFT' | 'PENDING_SIGNOFF' | 'FINAL' | 'AMENDED';

export interface Report {
  id: string;
  studyInstanceUid?: string;
  study?: Study;
  author: User;
  authorId: string;
  status: ReportStatus;
  version: number;
  findings: string;
  impression: string;
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
  findings: string;
  impression: string;
  authorId: string;
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
