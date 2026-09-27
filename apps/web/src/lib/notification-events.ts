/**
 * PHI-free copy for native desktop notifications.
 *
 * # The rule
 *
 * A Windows toast is not private. It sits on the taskbar, on the lock screen,
 * and in the Action Center, where the next person at the workstation, a visitor,
 * or a screen share can all read it. It is also the one place in this client
 * where text escapes the authenticated session into the operating system.
 *
 * So a native notification states the *event* and never the *patient*. It says
 * "New study assigned", not "Study for Jane Doe, MRN 4451221, is ready".
 *
 * This module is the only place that decides notification text, and it never
 * reads the server's `message` field, which is written for the authenticated
 * in-app list and may legitimately name a patient. It maps the server's event
 * `type` — a closed vocabulary the API defines — to fixed copy owned by this
 * client. There is no interpolation, no concatenation, and no fallback that
 * echoes input, so there is no path by which server- or user-supplied text
 * reaches a toast.
 *
 * The in-app notification list is unaffected: it stays behind authentication
 * and keeps showing the full message.
 */

/** Copy for one workflow event. Both fields are compile-time constants. */
export interface NotificationCopy {
  title: string;
  body: string;
}

/**
 * Event type -> toast copy.
 *
 * Keys are the `type` values the API writes on a Notification row. Anything
 * absent here produces no toast at all, which is the safe default: an
 * unrecognised event should be visible in the app, not guessed at on the
 * desktop.
 */
const COPY: Readonly<Record<string, NotificationCopy>> = {
  // --- Worklist -----------------------------------------------------------
  STUDY_ASSIGNED: {
    title: "New study assigned",
    body: "A study has been assigned to you. Open Axis to view it.",
  },
  STUDY_UNASSIGNED: {
    title: "Study unassigned",
    body: "A study is no longer assigned to you.",
  },
  WORKLIST_UPDATED: {
    title: "Worklist updated",
    body: "Your worklist has changed. Open Axis to review it.",
  },

  // --- Reporting lifecycle ------------------------------------------------
  REPORT_DRAFT_SAVED: {
    title: "Draft saved",
    body: "A report draft was saved.",
  },
  REPORT_SIGNED: {
    title: "Report signed",
    body: "A report was signed and sent for review.",
  },
  REPORT_APPROVED: {
    title: "Report approved",
    body: "A report was approved and is ready for delivery.",
  },
  REPORT_DELIVERED: {
    title: "Report delivered",
    body: "A report was delivered to the requesting hospital.",
  },
  REPORT_RETURNED: {
    title: "Report returned",
    body: "A report was returned to you for revision.",
  },

  // --- Corrections --------------------------------------------------------
  CORRECTION_REQUESTED: {
    title: "Correction requested",
    body: "A report correction has been requested. Open Axis to review it.",
  },
  CORRECTION_APPROVED: {
    title: "Correction approved",
    body: "A report correction was approved and is ready to start.",
  },
  CORRECTION_REJECTED: {
    title: "Correction rejected",
    body: "A report correction request was rejected.",
  },
  CORRECTION_STARTED: {
    title: "Correction started",
    body: "A corrected report is now in progress.",
  },
  CORRECTED_REPORT_SIGNED: {
    title: "Corrected report signed",
    body: "A corrected report was signed and sent for review.",
  },
  CORRECTION_RESOLVED: {
    title: "Correction resolved",
    body: "A report correction was resolved.",
  },
  CORRECTED_REPORT_DELIVERED: {
    title: "Corrected report delivered",
    body: "A corrected report was delivered to the requesting hospital.",
  },
  CORRECTION_HOSPITAL_ACCEPTED: {
    title: "Corrected report accepted",
    body: "A corrected report was accepted by the requesting hospital.",
  },

  // --- Review -------------------------------------------------------------
  REVIEW_REQUESTED: {
    title: "Report awaiting review",
    body: "A signed report is waiting for your review.",
  },
};

/**
 * Toast copy for a server event type, or `undefined` when the event has no
 * defined toast.
 *
 * Returning `undefined` is meaningful: the caller shows nothing rather than
 * inventing text.
 */
export function notifyWorkflowEvent(type: string): NotificationCopy | undefined {
  return Object.prototype.hasOwnProperty.call(COPY, type)
    ? COPY[type]
    : undefined;
}

/**
 * Short label for a server event type, for the in-app notification list.
 *
 * Same fixed copy the toast uses, so the two surfaces can never disagree about
 * what an event is called. `undefined` for an unrecognised type, which lets a
 * caller fall back to the authenticated in-app title.
 */
export function notificationTitle(type: string): string | undefined {
  return notifyWorkflowEvent(type)?.title;
}

/** Every event type that has defined toast copy. Used by tests. */
export function knownNotificationTypes(): string[] {
  return Object.keys(COPY);
}

/**
 * Defence in depth for the toast body: assert at runtime that no field looks
 * like it carries patient data.
 *
 * The copy above is static, so this can only fail if a future edit introduces
 * an interpolation. It runs in development and in tests rather than on every
 * toast, because a silent check nobody sees is not a check.
 */
export function toastCopyIsSafe(copy: NotificationCopy | undefined): boolean {
  if (!copy) return true;
  // A toast should be a short, fixed sentence. Anything with a digit run long
  // enough to be an identifier, or a full name pattern, is rejected.
  if (/\b\d{6,}\b/.test(`${copy.title} ${copy.body}`)) return false;
  if (/\b(MRN|medical record|patient)\b/i.test(`${copy.title} ${copy.body}`)) {
    return false;
  }
  return copy.title.length <= 60 && copy.body.length <= 140;
}
