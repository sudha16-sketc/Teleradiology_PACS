import type { Study, StudyPriority, StudyStatus, Modality, Subspecialty } from './study.js';

export interface WorklistItem {
  study: Study;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  tatMinutes?: number;
  slaRemaining?: number;
}

export interface WorklistFilters {
  search?: string;
  priority?: StudyPriority[];
  modality?: Modality[];
  hospitalId?: string[];
  subspecialty?: Subspecialty[];
  status?: StudyStatus[];
  dateFrom?: string;
  dateTo?: string;
}

export type WorklistSortField = 'priority' | 'studyDate' | 'modality' | 'hospital' | 'tatDeadline' | 'status' | 'patient';
export type WorklistSortDirection = 'asc' | 'desc';

export interface WorklistSort {
  field: WorklistSortField;
  direction: WorklistSortDirection;
}
