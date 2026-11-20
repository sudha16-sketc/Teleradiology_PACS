import type { RetentionPolicy } from '@axis/types';

const DEFAULT_RETENTION_DAYS = 90;

function intEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum = 3650,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    return fallback;
  }
  return value;
}

export function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function retentionPolicy(): RetentionPolicy {
  const legacyRaw = Number(process.env.AXIS_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  const retentionDays =
    Number.isInteger(legacyRaw) && legacyRaw >= 0 && legacyRaw <= 3650
      ? legacyRaw
      : DEFAULT_RETENTION_DAYS;
  const policyVersion =
    process.env.RETENTION_POLICY_VERSION ??
    [
      retentionDays,
      intEnv('INITIAL_RETENTION_DAYS', 20, 1),
      intEnv('CANCEL_MAX_COUNT', 3, 1),
      intEnv('IGNORE_MAX_COUNT', 5, 1),
      intEnv('DICOM_BACKUP_RETENTION_DAYS', 14, 1),
      intEnv('METADATA_BACKUP_RETENTION_DAYS', 30, 1),
    ].join('-');

  return {
    retentionDays,
    requiresVerifiedBackup: booleanEnv('AXIS_RETENTION_REQUIRE_BACKUP', true),
    initialRetentionDays: intEnv('INITIAL_RETENTION_DAYS', 20, 1),
    cancelReminderDays: intEnv('CANCEL_REMINDER_DAYS', 20, 1),
    cancelMaxCount: intEnv('CANCEL_MAX_COUNT', 3, 1, 100),
    ignoreResponseHours: intEnv('IGNORE_RESPONSE_HOURS', 24, 1, 8760),
    ignoreReminderDays: intEnv('IGNORE_REMINDER_DAYS', 3, 1),
    ignoreMaxCount: intEnv('IGNORE_MAX_COUNT', 5, 1, 100),
    dicomBackupRetentionDays: intEnv('DICOM_BACKUP_RETENTION_DAYS', 14, 1),
    metadataBackupRetentionDays: intEnv('METADATA_BACKUP_RETENTION_DAYS', 30, 1),
    mandatoryRetentionDays: intEnv('MANDATORY_RETENTION_DAYS', 0, 0),
    schedulerEnabled: booleanEnv('RETENTION_SCHEDULER_ENABLED', false),
    dryRun: booleanEnv('RETENTION_DRY_RUN', true),
    destructiveEnabled: booleanEnv('RETENTION_DELETE_ENABLED', false),
    jobRetryLimit: intEnv('RETENTION_JOB_RETRY_LIMIT', 5, 1, 100),
    policyVersion,
  };
}

export const RETENTION_ENV_FLAGS = {
  schedulerEnabled: 'RETENTION_SCHEDULER_ENABLED',
  dryRun: 'RETENTION_DRY_RUN',
  destructiveEnabled: 'RETENTION_DELETE_ENABLED',
  backupDeleteEnabled: 'RETENTION_BACKUP_DELETE_ENABLED',
  dicomArchiveEnabled: 'RETENTION_DICOM_ARCHIVE_ENABLED',
} as const;
