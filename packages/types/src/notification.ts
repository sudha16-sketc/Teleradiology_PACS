export interface AppNotification {
  id: string;
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  studyId?: string | null;
  correctionRequestId?: string | null;
  readAt?: string | null;
  createdAt: string;
}
