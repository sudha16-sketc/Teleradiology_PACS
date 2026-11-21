import type {
  ArchivedReportArtifact,
  ArchivedReportArtifactSet,
  ArchivedReportVersionArtifact,
  ArchivedStudyArtifact,
  RetentionArchiveManifest,
} from '@axis/types';
import type { RetentionStudy } from './retention-eligibility.service.js';

export function buildArchivedReportArtifact(
  study: RetentionStudy,
  archiveId: string,
  archivedAt: Date,
): ArchivedReportArtifactSet {
  const reports: ArchivedReportArtifact[] = study.reports.map((report) => ({
    id: report.id,
    version: report.version,
    status: String(report.status),
    signedOffAt: report.signedOffAt?.toISOString() ?? null,
    signedOffBy: report.signedOffBy,
    contentHash: report.contentHash,
    contentHtml: report.contentHtml,
    findings: report.findings,
    impression: report.impression,
    recommendations: report.recommendations,
    clinicalHistory: report.clinicalHistory,
    comparison: report.comparison,
    technique: report.technique,
    criticalFinding: report.criticalFinding,
    criticalFindingAcknowledged: report.criticalFindingAcknowledged,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    author: report.author
      ? {
          id: report.author.id,
          displayName: report.author.displayName,
          email: report.author.email,
          role: String(report.author.role),
        }
      : null,
  }));
  const versionSnapshots: ArchivedReportVersionArtifact[] = study.reports.flatMap((report) =>
    report.versions.map((version) => ({
      id: version.id,
      reportId: version.reportId,
      version: version.version,
      status: String(version.status),
      createdAt: version.createdAt.toISOString(),
      authorId: version.authorId,
      author: version.author
        ? {
            id: version.author.id,
            displayName: version.author.displayName,
            email: version.author.email,
            role: String(version.author.role),
          }
        : null,
      contentHash: version.contentHash,
      contentHtml: version.contentHtml,
      findings: version.findings,
      impression: version.impression,
      recommendations: version.recommendations,
      clinicalHistory: version.clinicalHistory,
      comparison: version.comparison,
      technique: version.technique,
    })),
  );
  return {
    archiveId,
    studyInstanceUid: study.studyInstanceUid,
    accessionNumber: study.accessionNumber,
    status: String(study.status),
    completedAt: study.completedAt?.toISOString() ?? null,
    archivedAt: archivedAt.toISOString(),
    hospital: {
      id: study.hospital.id,
      name: study.hospital.name,
    },
    patient: {
      id: study.patient.id,
      patientId: study.patient.patientId,
      displayName: study.patient.displayName,
      dateOfBirth: study.patient.dateOfBirth?.toISOString() ?? null,
      gender: study.patient.gender ? String(study.patient.gender) : null,
      hospitalId: study.patient.hospitalId,
    },
    reports,
    versionSnapshots,
  };
}

export function buildArchivedStudyArtifact(
  study: RetentionStudy,
  archiveId: string,
): ArchivedStudyArtifact {
  return {
    archiveId,
    studyInstanceUid: study.studyInstanceUid,
    accessionNumber: study.accessionNumber,
    hospitalId: study.hospitalId,
    hospitalName: study.hospital.name,
    patientId: study.patient.patientId,
    patientDisplayName: study.patient.displayName,
    modality: String(study.modality),
    bodyPart: study.bodyPart,
    studyDate: study.studyDate.toISOString(),
    studyTime: study.studyTime,
    status: String(study.status),
    reportStatus: study.reports.map((report) => String(report.status)),
    reportCount: study.reports.length,
    signedReportCount: study.reports.filter((report) => report.signedOffAt).length,
  };
}

export function buildRetentionArchiveManifest(input: {
  archiveId: string;
  generatedAt: Date;
  studyInstanceUid: string;
  policyVersion: string;
  initialRetentionDays: number;
  dicomBackupRetentionDays: number;
  metadataBackupRetentionDays: number;
  dicomObjectKey: string | null;
  dicomChecksum: string | null;
  dicomObjectOwned: boolean;
  reportSha256: string;
  studySha256: string;
  reportObjectKey: string;
  studyObjectKey: string;
}): RetentionArchiveManifest {
  return {
    version: 1,
    archiveId: input.archiveId,
    generatedAt: input.generatedAt.toISOString(),
    studyInstanceUid: input.studyInstanceUid,
    policyVersion: input.policyVersion,
    initialRetentionDays: input.initialRetentionDays,
    dicomBackupRetentionDays: input.dicomBackupRetentionDays,
    metadataBackupRetentionDays: input.metadataBackupRetentionDays,
    dicomObjectKey: input.dicomObjectKey,
    dicomChecksum: input.dicomChecksum,
    dicomObjectOwned: input.dicomObjectOwned,
    reportSha256: input.reportSha256,
    studySha256: input.studySha256,
    artifacts: {
      report: {
        file: 'report.json',
        sha256: input.reportSha256,
        objectKey: input.reportObjectKey,
      },
      study: {
        file: 'study.json',
        sha256: input.studySha256,
        objectKey: input.studyObjectKey,
      },
      dicom: {
        file: 'dicom.tar.gz',
        sha256: input.dicomChecksum,
        objectKey: input.dicomObjectKey,
      },
    },
  };
}

export function parseRetentionArchiveManifest(
  value: unknown,
): RetentionArchiveManifest | null {
  if (!isRecord(value) || !isRecord(value.artifacts)) return null;
  const report = value.artifacts.report;
  const study = value.artifacts.study;
  const dicom = value.artifacts.dicom;
  if (!isRecord(report) || !isRecord(study) || !isRecord(dicom)) return null;
  if (
    typeof value.archiveId !== 'string' ||
    typeof value.studyInstanceUid !== 'string' ||
    typeof value.reportSha256 !== 'string' ||
    typeof value.studySha256 !== 'string' ||
    typeof report.objectKey !== 'string' ||
    typeof report.sha256 !== 'string' ||
    typeof study.objectKey !== 'string' ||
    typeof study.sha256 !== 'string' ||
    typeof value.dicomObjectOwned !== 'boolean'
  ) {
    return null;
  }
  if (dicom.objectKey !== null && typeof dicom.objectKey !== 'string') return null;
  if (dicom.sha256 !== null && typeof dicom.sha256 !== 'string') return null;
  return value as unknown as RetentionArchiveManifest;
}

export function archivedReportMatchesStudy(
  artifact: ArchivedReportArtifactSet,
  archiveId: string,
  study: RetentionStudy,
): boolean {
  if (
    artifact.archiveId !== archiveId ||
    artifact.studyInstanceUid !== study.studyInstanceUid ||
    artifact.reports.length !== study.reports.length
  ) {
    return false;
  }
  const expected = new Set(
    study.reports.map((report: { contentHash: string | null }) => report.contentHash ?? ''),
  );
  const actual = new Set(
    artifact.reports.map((report: ArchivedReportArtifact) => report.contentHash ?? ''),
  );
  if (expected.size !== actual.size) return false;
  if (![...expected].every((hash) => actual.has(hash))) return false;
  if (!Array.isArray(artifact.versionSnapshots)) return false;
  const expectedVersions = new Set(
    study.reports.flatMap((report) =>
      report.versions.map((version) =>
        [
          version.id,
          version.reportId,
          version.version,
          String(version.status),
          version.createdAt.toISOString(),
          version.authorId,
          version.contentHash,
        ].join(':'),
      ),
    ),
  );
  const actualVersions = new Set(
    artifact.versionSnapshots.map((version) =>
      [
        version.id,
        version.reportId,
        version.version,
        version.status,
        version.createdAt,
        version.authorId,
        version.contentHash,
      ].join(':'),
    ),
  );
  return expectedVersions.size === actualVersions.size &&
    [...expectedVersions].every((key) => actualVersions.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
