export type BackupStatus = 'RUNNING' | 'COMPLETED' | 'VERIFIED' | 'FAILED';

export type BackupType = 'DATABASE' | 'DICOM' | 'FULL';

export interface BackupRun {
  id: string;
  type: BackupType;
  status: BackupStatus;
  startedAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
  databaseArtifact?: string | null;
  dicomArtifact?: string | null;
  checksum?: string | null;
  sizeBytes?: string | null;
  backupDirectory?: string | null;
  verifiedAt?: string | null;
  failureReason?: string | null;
  createdById?: string | null;
  createdAt: string;
}

export type SlaPriority = 'STAT' | 'URGENT' | 'ROUTINE';

export interface SlaConfig {
  id: string;
  priority: SlaPriority;
  minutes: number;
  isActive: boolean;
  updatedBy?: string | null;
  updatedAt: string;
}

/** Server-computed SLA / TAT result for a single study. */
export interface StudySlaComputation {
  studyId: string;
  studyInstanceUid: string;
  accessionNumber: string;
  patientName: string;
  hospitalName: string;
  modality: string;
  priority: string;
  status: string;
  dueAt?: string | null;
  slaDeadline?: string | null;
  remainingMinutes?: number | null;
  breached: boolean;
  unassignedMinutes?: number | null;
  reportingMinutes?: number | null;
  reviewMinutes?: number | null;
  deliveryMinutes?: number | null;
  totalMinutes?: number | null;
}

/** Operational readiness probe result. */
export interface HealthComponent {
  name: string;
  status: 'up' | 'down';
  latencyMs?: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  components: HealthComponent[];
  timestamp: string;
}

export interface RetentionCandidate {
  studyId: string;
  studyInstanceUid: string;
  accessionNumber: string;
  hospitalName: string;
  completedAt?: string | null;
  daysSinceCompletion: number;
  verifiedBackupExists: boolean;
  hasActiveCorrection: boolean;
  archivalLocked: boolean;
  eligible: boolean;
  reason?: string;
}

export interface RetentionPreviewResult {
  candidates: RetentionCandidate[];
  eligibleCount: number;
  policy: {
    retentionDays: number;
    requiresVerifiedBackup: boolean;
  };
}
