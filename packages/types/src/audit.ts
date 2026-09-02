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
  | 'DELIVERY_COMPLETED';

export type AuditResource =
  | 'STUDY'
  | 'REPORT'
  | 'USER'
  | 'ROUTING_RULE'
  | 'HOSPITAL'
  | 'WORKLIST'
  | 'DELIVERY'
  | 'AI_JOB'
  | 'AUTH';

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
  metadata?: Record<string, unknown>;
}
