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

export type RetentionAnchorSource =
  | 'COMPLETED_AT'
  | 'HOSPITAL_ACCEPTED_AT'
  | 'DELIVERED_AT'
  | 'STUDY_DATE';

export type RetentionStatus =
  | 'PENDING_RETENTION'
  | 'AWAITING_USER_RESPONSE'
  | 'CANCELLED_DEFERRED'
  | 'NOTIFICATION_IGNORED'
  | 'AUTOMATIC_PROCESSING'
  | 'ARCHIVING'
  | 'ARCHIVE_VERIFICATION'
  | 'ARCHIVED'
  | 'ORIGINAL_DATA_CLEANUP'
  | 'BACKUP_RETENTION'
  | 'DICOM_DELETED'
  | 'METADATA_DELETED'
  | 'COMPLETED'
  | 'ON_HOLD'
  | 'FAILED';

export type RetentionLockReason =
  | 'LEGAL_HOLD'
  | 'ACTIVE_DISPUTE'
  | 'HOSPITAL_RETENTION_REQUEST'
  | 'PENDING_REPORT_DELIVERY'
  | 'MANDATORY_RETENTION'
  | 'INVESTIGATION';

export interface RetentionCandidate {
  studyId: string;
  studyInstanceUid: string;
  accessionNumber: string;
  hospitalName: string;
  completedAt?: string | null;
  retentionAnchorAt: string;
  retentionAnchorSource: RetentionAnchorSource;
  daysSinceCompletion: number;
  daysSinceAnchor: number;
  verifiedBackupExists: boolean;
  verifiedBackupId?: string | null;
  hasActiveCorrection: boolean;
  archivalLocked: boolean;
  eligible: boolean;
  reason?: string;
  retentionStatus?: RetentionStatus | null;
  retentionLocked: boolean;
  lockReason?: RetentionLockReason | null;
  cancelCount: number;
  ignoredCount: number;
  nextActionAt?: string | null;
  archiveStatus?: string | null;
  dicomDeleteAt?: string | null;
  metadataDeleteAt?: string | null;
}

export interface RetentionSkipSummary {
  reason: string;
  count: number;
}

export interface RetentionPolicy {
  retentionDays: number;
  requiresVerifiedBackup: boolean;
  initialRetentionDays: number;
  cancelReminderDays: number;
  cancelMaxCount: number;
  ignoreResponseHours: number;
  ignoreReminderDays: number;
  ignoreMaxCount: number;
  dicomBackupRetentionDays: number;
  metadataBackupRetentionDays: number;
  mandatoryRetentionDays: number;
  schedulerEnabled: boolean;
  dryRun: boolean;
  destructiveEnabled: boolean;
  jobRetryLimit: number;
  policyVersion: string;
}

export interface RetentionUpcomingAction {
  studyId?: string | null;
  type: string;
  dueAt: string;
  status: string;
}

export interface RetentionPreviewResult {
  candidates: RetentionCandidate[];
  eligibleCount: number;
  reviewed: number;
  inspected: number;
  eligible: number;
  ineligible: number;
  onHold: number;
  awaitingRetention: number;
  awaitingUserResponse: number;
  readyForArchive: number;
  alreadyArchived: number;
  failedArchives: number;
  dicomBackupsDue: number;
  metadataBackupsDue: number;
  skipped: number;
  skippedReasons: RetentionSkipSummary[];
  upcomingActions: RetentionUpcomingAction[];
  policy: RetentionPolicy;
}

export interface RetentionExecutionResult extends RetentionPreviewResult {
  archived: number;
  processed: number;
  jobsCreated: number;
  notificationsSent: number;
  archiveFailures: number;
  skippedByReason: RetentionSkipSummary[];
}

export interface RetentionNotificationView {
  id: string;
  studyId: string;
  studyInstanceUid: string;
  accessionNumber: string;
  hospitalName: string;
  reportStatus: string;
  sequenceNumber: number;
  sentAt?: string | null;
  responseDeadline?: string | null;
  respondedAt?: string | null;
  response?: 'CANCEL' | 'DELETE' | 'IGNORED' | null;
  deliveryStatus: string;
  cancelCount: number;
  ignoredCount: number;
}

export interface RetentionJobView {
  id: string;
  type: string;
  status: string;
  studyId?: string | null;
  dueAt: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
}

export interface RetentionResponseResult {
  notificationId: string;
  response: 'CANCEL' | 'DELETE';
  retentionStatus: RetentionStatus;
  cancelCount: number;
  ignoredCount: number;
  nextActionAt: string;
}
