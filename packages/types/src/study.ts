import type { Patient } from './patient.js';
import type { Hospital } from './hospital.js';
import type { User } from './user.js';

export type StudyPriority = 'STAT' | 'URGENT' | 'ROUTINE';

export type StudyStatus = 'NEW' | 'SUBMITTED' | 'VALIDATED' | 'UNASSIGNED' | 'ASSIGNED' | 'IN_READING' | 'DRAFT_REPORT' | 'FINAL' | 'AMENDED' | 'DELIVERED' | 'CANCELLED';

export type Modality = 'CT' | 'MRI' | 'XR' | 'US' | 'NM' | 'PET' | 'MG' | 'DX' | 'CR' | 'Fluoro';

export type Subspecialty = 'NEURO' | 'MSK' | 'CHEST' | 'ABDOMEN' | 'CARDIOVASCULAR' | 'MAMMOGRAPHY' | 'MUSCULOSKELETAL' | 'GENERAL' | 'PEDIATRIC' | 'ONCOLOGY' | 'INTERVENTIONAL';

export interface Study {
  studyInstanceUid: string;
  patient: Patient;
  accessionNumber: string;
  studyDate: string;
  studyTime: string;
  modality: Modality;
  bodyPart: string;
  hospital: Hospital;
  hospitalId: string;
  referringPhysician: string;
  studyDescription: string;
  clinicalHistory?: string;
  priority: StudyPriority;
  status: StudyStatus;
  subspecialty: Subspecialty;
  assignedRadiologist?: User;
  assignedRadiologistId?: string;
  assignedBy?: string;
  receivedAt?: string;
  assignedAt?: string;
  reportingStartedAt?: string;
  finalizedAt?: string;
  dueAt?: string;
  seriesCount: number;
  instanceCount: number;
  slaDeadline?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Series {
  seriesInstanceUid: string;
  studyInstanceUid: string;
  modality: Modality;
  seriesNumber: number;
  seriesDescription: string;
  instanceCount: number;
  bodyPart: string;
  createdAt: string;
}

export interface Instance {
  sopInstanceUid: string;
  seriesInstanceUid: string;
  studyInstanceUid: string;
  instanceNumber: number;
  sopClassUid: string;
  createdAt: string;
}
