export interface AppNotification {
  id: string;
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  /** Internal Study primary key. NOT routable — use study.studyInstanceUid. */
  studyId?: string | null;
  /**
   * The referenced study, projected by the API so a notification can deep-link
   * to `/reading/[studyInstanceUid]`. Null once the study has been removed
   * (e.g. archival), in which case the notification is not clickable.
   */
  study?: { studyInstanceUid: string } | null;
  correctionRequestId?: string | null;
  readAt?: string | null;
  createdAt: string;
}
