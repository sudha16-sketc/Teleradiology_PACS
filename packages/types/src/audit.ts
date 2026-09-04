export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'STUDY_VIEWED'
  | 'STUDY_DOWNLOADED'
  | 'STUDY_ASSIGNED'
  | 'STUDY_STATUS_CHANGED'
  | 'REPORT_VIEWED'
  | 'REPORT_CREATED'
  | 'REPORT_EDITED'
  | 'REPORT_SIGNED'
  | 'REPORT_AMENDED'
  | 'REPORT_FINALIZED'
  | 'CRITICAL_FINDING_FLAGGED'
  | 'CRITICAL_FINDING_ACKNOWLEDGED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'ROUTING_RULE_CHANGED'
  | 'DELIVERY_ATTEMPTED'
  | 'DELIVERY_FAILED'
  | 'DELIVERY_COMPLETED'
  | 'STUDY_SUBMITTED'
  | 'STUDY_UPLOADED'
  | 'DICOM_IMPORTED'
  | 'DICOM_IMPORT_FAILED'
  | 'STUDY_VALIDATED'
  | 'STUDY_REASSIGNED'
  | 'REPORT_SUBMITTED'
  | 'REPORT_VERIFIED'
  | 'REPORT_REVISED'
  | 'REPORT_RELEASED'
  | 'CHANGE_REQUESTED'
  | 'HOSPITAL_ACCEPTED'
  | 'HOSPITAL_CHANGE_REQUESTED'
  | 'CORRECTION_REQUESTED'
  | 'CORRECTION_APPROVED'
  | 'CORRECTION_REJECTED'
  | 'CORRECTION_STARTED'
  | 'CORRECTED_REPORT_SIGNED'
  | 'CORRECTION_RESOLVED'
  | 'SLA_CONFIG_CHANGED'
  | 'BACKUP_STARTED'
  | 'BACKUP_COMPLETED'
  | 'BACKUP_FAILED'
  | 'BACKUP_VERIFIED'
  | 'RETENTION_PREVIEW'
  | 'RETENTION_EXECUTED'
  | 'ARCHIVE_MARKED';

export type AuditResource =
  | 'STUDY'
  | 'REPORT'
  | 'USER'
  | 'ROUTING_RULE'
  | 'HOSPITAL'
  | 'WORKLIST'
  | 'DELIVERY'
  | 'AI_JOB'
  | 'AUTH'
  | 'CHANGE_REQUEST'
  | 'ASSIGNMENT'
  | 'BACKUP'
  | 'RETENTION';

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}
