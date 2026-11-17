import type { User } from './user.js';
import type { Study } from './study.js';

export type ReportStatus = 'DRAFT' | 'SIGNED' | 'RADIOLOGIST_SIGNED' | 'MANAGER_REVIEW' | 'MANAGER_APPROVED' | 'HOSPITAL_REVIEW' | 'CORRECTION_REQUESTED';

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
  contentHtml?: string | null;
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
  contentHtml?: string | null;
  authorId: string;
  author?: User;
  contentHash: string;
  createdAt: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  description?: string;
  modality?: string;
  subspecialty?: string;
  bodyPart?: string;
  clinicalHistory?: string;
  findings?: string;
  impression?: string;
  technique?: string;
  comparison?: string;
  recommendations?: string;
  contentHtml?: string;
  isActive: boolean;
  creator?: {
    id: string;
    displayName: string;
    email: string;
  };
  createdById?: string;
}

export interface ReportImage {
  id: string;
  reportId: string;
  studyId: string;
  uploadedById: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface CompanySettings {
  id: string;
  name: string;
  phone: string;
  email: string;
  description: string;
  disclaimer: string;
  updatedById?: string | null;
  createdAt: string;
  updatedAt: string;
}
