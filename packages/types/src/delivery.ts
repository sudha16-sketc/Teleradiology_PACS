export type DeliveryStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'RETRYING';

export interface DeliveryAttempt {
  id: string;
  studyInstanceUid: string;
  reportId: string;
  hospitalId: string;
  status: DeliveryStatus;
  attemptNumber: number;
  deliveredAt?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
