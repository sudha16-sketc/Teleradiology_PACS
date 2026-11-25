import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditResource,
  ManualDeletionArchiveStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { AuditService } from '../audit/audit.service.js';
import { BACKUP_STORAGE, type BackupStorage } from '../backup/backup-storage.js';
import {
  createDicomWebArchive,
  restoreDicomArchiveObjects,
} from '../backup/dicom-backup.js';
import { resolveBackupEnv, verifyChecksum } from '../backup/backup-ops.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListDeletedDto } from './dto/manual-deletion.dto.js';

interface DeletionActor {
  id: string;
  role: UserRole;
  hospitalId?: string | null;
  displayName?: string;
}

interface ArchiveFile {
  kind: 'report-image' | 'study-history';
  storageKey: string;
  objectKey: string;
  checksum: string;
}

type JsonRecord = Record<string, unknown>;

interface StudySnapshot {
  version: 1;
  archiveId: string;
  hospitalId: string;
  studyInstanceUid: string;
  patientShouldDelete: boolean;
  records: Record<string, unknown>;
  files: ArchiveFile[];
}

interface CollectedStudy {
  patientRecordId: string;
  hospitalName: string;
  patientShouldDelete: boolean;
  records: Record<string, unknown>;
  fileRows: Array<{
    kind: ArchiveFile['kind'];
    storageKey: string;
  }>;
  studyUid: string;
  studyId: string;
  hospitalId: string;
  accessionNumber: string;
  patientId: string;
  patientName: string;
  instanceCount: number;
};

const SNAPSHOT_TABLES = [
  'Patient',
  'Study',
  'Series',
  'Instance',
  'WorklistItem',
  'Report',
  'ReportVersion',
  'Assignment',
  'ChangeRequest',
  'DeliveryAttempt',
  'AIJob',
  'ReportImage',
  'StudyHistoryAttachment',
  'StudyRetention',
  'RetentionNotification',
  'RetentionAuditLog',
  'RetentionJob',
  'Notification',
] as const;

const ACTIVE_ARCHIVE_STATUSES: ManualDeletionArchiveStatus[] = [
  ManualDeletionArchiveStatus.ARCHIVING,
  ManualDeletionArchiveStatus.ARCHIVED,
  ManualDeletionArchiveStatus.RESTORING,
  ManualDeletionArchiveStatus.PURGING,
  ManualDeletionArchiveStatus.PURGE_FAILED,
  ManualDeletionArchiveStatus.FAILED,
];

const PURGEABLE_ARCHIVE_STATUSES: ManualDeletionArchiveStatus[] = [
  ManualDeletionArchiveStatus.ARCHIVED,
  ManualDeletionArchiveStatus.PURGE_FAILED,
  ManualDeletionArchiveStatus.FAILED,
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowsFrom(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new BadRequestException('The archive data is invalid');
  }
  return value;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function retentionDays(): number {
  const raw = process.env.MANUAL_DELETION_RETENTION_DAYS;
  if (raw === undefined || raw === '') return 30;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error('MANUAL_DELETION_RETENTION_DAYS must be between 1 and 3650');
  }
  return value;
}

function dateBound(value: string, inclusiveEnd = false): Date {
  const date = new Date(value);
  if (inclusiveEnd && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function isUniqueConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002';
  }
  if (!isRecord(error)) return false;
  const meta = error.meta;
  return (
    error.code === 'P2010' &&
    isRecord(meta) &&
    meta.code === '23505'
  );
}

@Injectable()
export class ManualDeletionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(BACKUP_STORAGE) private readonly storage: BackupStorage,
  ) {}

  async deleteStudies(studyUids: string[], actor: DeletionActor) {
    this.assertManagerScope(actor);
    const uniqueUids = [...new Set(studyUids.map((uid) => uid.trim()))];
    if (
      uniqueUids.length !== studyUids.length ||
      uniqueUids.some((uid) => !uid || uid.length > 128)
    ) {
      throw new BadRequestException('Study identifiers must be unique and valid');
    }

    const results: Array<{
      studyInstanceUid: string;
      status: 'DELETED' | 'FAILED';
      archiveId?: string;
      error?: string;
    }> = [];
    for (const studyUid of uniqueUids) {
      try {
        const result = await this.deleteStudy(studyUid, actor);
        results.push({
          studyInstanceUid: studyUid,
          status: 'DELETED',
          archiveId: result.archiveId,
        });
      } catch (error) {
        results.push({
          studyInstanceUid: studyUid,
          status: 'FAILED',
          error: this.publicError(error),
        });
      }
    }
    return { data: results };
  }

  async list(query: ListDeletedDto, actor: DeletionActor) {
    this.assertManagerScope(actor);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.ManualDeletionArchiveWhereInput = {
      ...(actor.role === UserRole.MANAGER
        ? { hospitalId: actor.hospitalId as string }
        : {}),
      ...(query.patientId ? { patientId: { contains: query.patientId, mode: 'insensitive' } } : {}),
      ...(query.status
        ? { status: query.status as ManualDeletionArchiveStatus }
        : {}),
      ...(query.from || query.to
        ? {
            deletedAt: {
              ...(query.from ? { gte: dateBound(query.from) } : {}),
              ...(query.to ? { lte: dateBound(query.to, true) } : {}),
            },
          }
        : {}),
      ...(query.deletedBy
        ? {
            OR: [
              { deletedById: query.deletedBy },
              { deletedByName: { contains: query.deletedBy, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    if (query.recordType && query.recordType !== 'STUDY') {
      throw new BadRequestException('Only STUDY archives are supported');
    }

    const [data, total] = await Promise.all([
      this.prisma.manualDeletionArchive.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          hospitalId: true,
          hospitalName: true,
          studyInstanceUid: true,
          accessionNumber: true,
          patientId: true,
          patientName: true,
          deletedById: true,
          deletedByName: true,
          deletedByRole: true,
          deletedAt: true,
          expiresAt: true,
          restoredAt: true,
        },
      }),
      this.prisma.manualDeletionArchive.count({ where }),
    ]);

    return {
      data: data.map((archive) => ({
        ...archive,
        recordType: 'STUDY',
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async restore(archiveId: string, actor: DeletionActor) {
    this.assertManagerScope(actor);
    const archive = await this.loadArchive(archiveId, actor);
    if (archive.status === ManualDeletionArchiveStatus.RESTORED) {
      return { data: { id: archive.id, status: archive.status, alreadyRestored: true } };
    }
    if (archive.status !== ManualDeletionArchiveStatus.ARCHIVED) {
      throw new ConflictException('Only a fully archived study can be restored');
    }
    if (archive.expiresAt <= new Date()) {
      throw new ConflictException(
        'The recovery period has expired; ask an administrator to permanently purge this archive',
      );
    }

    const claimed = await this.prisma.manualDeletionArchive.updateMany({
      where: {
        id: archive.id,
        status: ManualDeletionArchiveStatus.ARCHIVED,
      },
      data: { status: ManualDeletionArchiveStatus.RESTORING, lastError: null },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('This archive is already being processed');
    }

    try {
      const payload = await this.downloadSnapshot(archive);
      const active = await this.prisma.study.findFirst({
        where: {
          OR: [
            { id: this.requiredRowId(payload.records, 'Study') },
            { studyInstanceUid: archive.studyInstanceUid },
            { accessionNumber: archive.accessionNumber },
          ],
        },
        select: { id: true },
      });
      if (active) {
        throw new ConflictException(
          'A study with one of these identifiers already exists; no records were overwritten',
        );
      }

      const mappings = await this.restoreDicom(archive, payload);
      const fileObjects = this.archiveFiles(archive.fileObjects);
      await this.restoreFiles(fileObjects);
      const rows = this.applyDicomMappings(payload.records, mappings);

      await this.prisma.$transaction(async (tx) => {
        await this.assertPatientReady(tx, rows, payload.patientShouldDelete);
        for (const table of SNAPSHOT_TABLES) {
          const value = table === 'Patient' && !payload.patientShouldDelete
            ? []
            : rows[table];
          await this.insertRows(tx, table, value);
        }
        await tx.manualDeletionArchive.update({
          where: { id: archive.id },
          data: {
            status: ManualDeletionArchiveStatus.RESTORED,
            restoredAt: new Date(),
            lastError: null,
          },
        });
        await this.audit.createTx(tx, {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.id,
          actorRole: actor.role,
          action: AuditAction.MANUAL_DATA_RESTORED,
          resource: AuditResource.MANUAL_DELETION,
          resourceId: archive.id,
          metadata: {
            studyInstanceUid: archive.studyInstanceUid,
            hospitalId: archive.hospitalId,
          },
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
      });
      return { data: { id: archive.id, status: ManualDeletionArchiveStatus.RESTORED } };
    } catch (error) {
      await this.prisma.manualDeletionArchive.updateMany({
        where: {
          id: archive.id,
          status: ManualDeletionArchiveStatus.RESTORING,
        },
        data: {
          status: ManualDeletionArchiveStatus.ARCHIVED,
          lastError: this.safeError(error),
        },
      });
      if (isUniqueConflict(error)) {
        throw new ConflictException(
          'A record with the same identifier already exists; no existing data was overwritten',
        );
      }
      if (error instanceof HttpException) throw error;
      throw new ConflictException(
        'Restoration could not be completed; the archive remains available for a safe retry',
      );
    }
  }

  async purge(archiveId: string, actor: DeletionActor, confirmation: string) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only ADMIN may permanently purge archives');
    }
    if (confirmation !== archiveId) {
      throw new BadRequestException('Type the archive id to confirm permanent deletion');
    }
    const archive = await this.prisma.manualDeletionArchive.findUnique({
      where: { id: archiveId },
    });
    if (!archive) throw new NotFoundException('Archive not found');
    if (archive.status === ManualDeletionArchiveStatus.PURGED) {
      return { data: { id: archive.id, status: archive.status, alreadyPurged: true } };
    }
    if (!PURGEABLE_ARCHIVE_STATUSES.includes(archive.status)) {
      throw new ConflictException('This archive cannot be permanently purged now');
    }

    const claimed = await this.prisma.manualDeletionArchive.updateMany({
      where: { id: archive.id, status: archive.status },
      data: { status: ManualDeletionArchiveStatus.PURGING, lastError: null },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('This archive is already being processed');
    }

    try {
      const env = resolveBackupEnv();
      const prefix = this.archivePrefix(env, archive.hospitalId, archive.id);
      const remoteObjects = this.storage.remote ? await this.storage.list(prefix) : [];
      const keys = [
        ...remoteObjects.map((item) => item.key),
        archive.metadataObjectKey,
        archive.dicomObjectKey,
        ...this.archiveFiles(archive.fileObjects).map((file) => file.objectKey),
      ].filter((key): key is string => Boolean(key));
      if (!this.storage.remote) {
        await fs.rm(prefix, { recursive: true, force: true });
        if (await this.storage.head(prefix)) {
          throw new Error('The local archive directory could not be permanently deleted');
        }
      } else {
        for (const key of new Set(keys)) await this.deleteArchivedObject(key);
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.manualDeletionArchive.update({
          where: { id: archive.id },
          data: {
            status: ManualDeletionArchiveStatus.PURGED,
            hospitalName: 'Purged',
            studyInstanceUid: `PURGED:${archive.id}`,
            accessionNumber: `PURGED:${archive.id}`,
            patientId: 'PURGED',
            patientName: 'Purged',
            purgedAt: new Date(),
            metadataObjectKey: null,
            metadataChecksum: null,
            dicomObjectKey: null,
            dicomChecksum: null,
            fileObjects: Prisma.DbNull,
            lastError: null,
          },
        });
        await this.audit.createTx(tx, {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.id,
          actorRole: actor.role,
          action: AuditAction.MANUAL_DATA_PURGED,
          resource: AuditResource.MANUAL_DELETION,
          resourceId: archive.id,
          metadata: {
            studyInstanceUid: archive.studyInstanceUid,
            hospitalId: archive.hospitalId,
            purgedObjectCount: keys.length,
          },
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
      });
      return { data: { id: archive.id, status: ManualDeletionArchiveStatus.PURGED } };
    } catch (error) {
      await this.prisma.manualDeletionArchive.updateMany({
        where: {
          id: archive.id,
          status: ManualDeletionArchiveStatus.PURGING,
        },
        data: {
          status: ManualDeletionArchiveStatus.PURGE_FAILED,
          lastError: this.safeError(error),
        },
      });
      if (error instanceof HttpException) throw error;
      throw new ConflictException(
        'Permanent purge is incomplete; retrying the operation is safe',
      );
    }
  }

  private async deleteStudy(studyUid: string, actor: DeletionActor) {
    const alreadyDeleted = await this.prisma.manualDeletionArchive.findFirst({
      where: {
        studyInstanceUid: studyUid,
        status: ManualDeletionArchiveStatus.ARCHIVED,
      },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, hospitalId: true },
    });
    const activeStudy = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      select: { id: true },
    });
    if (!activeStudy && alreadyDeleted) {
      this.assertStudyScope(actor, alreadyDeleted.hospitalId);
      return { archiveId: alreadyDeleted.id };
    }

    const collected = await this.collectStudy(studyUid, actor);
    const held = await this.prisma.study.findUnique({
      where: { id: collected.studyId },
      select: {
        retentionLocked: true,
        retention: { select: { retentionLocked: true } },
      },
    });
    if (held?.retentionLocked || held?.retention?.retentionLocked) {
      throw new ConflictException('A legal hold prevents deletion of this study');
    }
    if (
      (await this.prisma.retentionArchive.count({
        where: { studyId: collected.studyId },
      })) > 0
    ) {
      throw new ConflictException(
        'This study has a retention archive and cannot be manually deleted',
      );
    }

    const prior = await this.prisma.manualDeletionArchive.findFirst({
      where: {
        studyInstanceUid: collected.studyUid,
        status: { in: ACTIVE_ARCHIVE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (prior?.status === ManualDeletionArchiveStatus.ARCHIVED) {
      throw new ConflictException('This study already has an active deletion archive');
    }
    if (
      prior &&
      prior.status !== ManualDeletionArchiveStatus.FAILED
    ) {
      throw new ConflictException('This study already has a deletion in progress');
    }

    const archive =
      prior ??
      (await this.prisma.manualDeletionArchive.create({
        data: {
          hospitalId: collected.hospitalId,
          hospitalName: collected.hospitalName,
          studyInstanceUid: collected.studyUid,
          accessionNumber: collected.accessionNumber,
          patientId: collected.patientId,
          patientName: collected.patientName,
          deletedById: actor.id,
          deletedByName: actor.displayName ?? actor.id,
          deletedByRole: actor.role,
          expiresAt: new Date(Date.now() + retentionDays() * 24 * 60 * 60 * 1000),
        },
      }));
    if (prior?.status === ManualDeletionArchiveStatus.FAILED) {
      const claimed = await this.prisma.manualDeletionArchive.updateMany({
        where: {
          id: prior.id,
          status: ManualDeletionArchiveStatus.FAILED,
        },
        data: { status: ManualDeletionArchiveStatus.ARCHIVING, lastError: null },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('This study already has a deletion in progress');
      }
    }

    const env = resolveBackupEnv();
    const archivePrefix = this.archivePrefix(env, archive.hospitalId, archive.id);
    const scratchDir = await this.createScratchDirectory(env, 'manual-deletion-');
    let stagedFiles: ArchiveFile[] = [];
    try {
      const fileObjects = await this.archiveFilesToStorage(
        collected.fileRows,
        archivePrefix,
        scratchDir,
        archive.id,
      );
      stagedFiles = fileObjects;
      let dicomObjectKey: string | null = null;
      let dicomChecksum: string | null = null;
      if (collected.instanceCount > 0) {
        const dicomPath = path.join(scratchDir, 'study-dicom.tar.gz');
        const dicom = await createDicomWebArchive(
          dicomPath,
          env,
          collected.studyUid,
        );
        dicomObjectKey = this.objectKey(
          env,
          archivePrefix,
          'study-dicom.tar.gz',
        );
        await this.putArtifact(dicomPath, dicomObjectKey, archive.id, dicom.checksum);
        dicomChecksum = dicom.checksum;
      }

      const snapshot: StudySnapshot = {
        version: 1,
        archiveId: archive.id,
        hospitalId: collected.hospitalId,
        studyInstanceUid: collected.studyUid,
        patientShouldDelete: collected.patientShouldDelete,
        records: collected.records,
        files: fileObjects,
      };
      const metadataBuffer = Buffer.from(JSON.stringify(snapshot), 'utf8');
      const metadataPath = path.join(scratchDir, 'study-metadata.json');
      await fs.writeFile(metadataPath, metadataBuffer, { flag: 'wx', mode: 0o600 });
      const metadataChecksum = sha256(metadataBuffer);
      const metadataObjectKey = this.objectKey(env, archivePrefix, 'metadata.json');
      await this.putArtifact(
        metadataPath,
        metadataObjectKey,
        archive.id,
        metadataChecksum,
      );

      await this.prisma.manualDeletionArchive.update({
        where: { id: archive.id },
        data: {
          metadataObjectKey,
          metadataChecksum,
          dicomObjectKey,
          dicomChecksum,
          fileObjects: JSON.parse(JSON.stringify(fileObjects)) as Prisma.InputJsonValue,
        },
      });

      await this.removeOriginalFiles(collected.fileRows);
      await this.prisma.$transaction(async (tx) => {
        const current = await this.collectStudyWithClient(tx, studyUid, actor);
        if (
          current.studyId !== collected.studyId ||
          sha256(JSON.stringify(current.records)) !==
            sha256(JSON.stringify(collected.records))
        ) {
          throw new ConflictException(
            'Study data changed during archival; no active records were deleted',
          );
        }
        const currentHold = await tx.study.findUnique({
          where: { id: collected.studyId },
          select: {
            retentionLocked: true,
            retention: { select: { retentionLocked: true } },
          },
        });
        if (currentHold?.retentionLocked || currentHold?.retention?.retentionLocked) {
          throw new ConflictException('A legal hold prevents deletion of this study');
        }
        const archiveExists = await tx.retentionArchive.count({
          where: { studyId: collected.studyId },
        });
        if (archiveExists) {
          throw new ConflictException(
            'A retention archive was created during deletion; no active records were deleted',
          );
        }

        await this.deleteGraph(tx, collected);
        await tx.manualDeletionArchive.update({
          where: { id: archive.id },
          data: {
            status: ManualDeletionArchiveStatus.ARCHIVED,
            deletedAt: new Date(),
            lastError: null,
          },
        });
        await this.audit.createTx(tx, {
          actorId: actor.id,
          actorName: actor.displayName ?? actor.id,
          actorRole: actor.role,
          action: AuditAction.MANUAL_DATA_DELETED,
          resource: AuditResource.MANUAL_DELETION,
          resourceId: archive.id,
          metadata: {
            studyInstanceUid: collected.studyUid,
            accessionNumber: collected.accessionNumber,
            hospitalId: collected.hospitalId,
            patientId: collected.patientId,
            relatedCounts: {
              series: rowsFrom(collected.records.Series).length,
              instances: rowsFrom(collected.records.Instance).length,
              reports: rowsFrom(collected.records.Report).length,
            },
          },
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
      });
      return { archiveId: archive.id };
    } catch (error) {
      try {
        await this.restoreFiles(stagedFiles);
      } catch {
        await this.prisma.manualDeletionArchive.updateMany({
          where: {
            id: archive.id,
            status: ManualDeletionArchiveStatus.ARCHIVING,
          },
          data: {
            status: ManualDeletionArchiveStatus.FAILED,
            lastError: 'Local attachment recovery requires administrator attention',
          },
        });
        throw new ConflictException(
          'Deletion was stopped and recovery of a local attachment needs administrator attention',
        );
      }
      await this.prisma.manualDeletionArchive.updateMany({
        where: {
          id: archive.id,
          status: ManualDeletionArchiveStatus.ARCHIVING,
        },
        data: {
          status: ManualDeletionArchiveStatus.FAILED,
          lastError: this.safeError(error),
        },
      });
      throw error;
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  }

  private async collectStudy(studyUid: string, actor: DeletionActor) {
    return this.collectStudyWithClient(this.prisma, studyUid, actor);
  }

  private async collectStudyWithClient(
    db: Pick<
      Prisma.TransactionClient,
      | 'study'
      | 'hospital'
      | 'patient'
      | 'series'
      | 'instance'
      | 'worklistItem'
      | 'report'
      | 'reportVersion'
      | 'assignment'
      | 'changeRequest'
      | 'deliveryAttempt'
      | 'aIJob'
      | 'reportImage'
      | 'studyHistoryAttachment'
      | 'studyRetention'
      | 'retentionNotification'
      | 'retentionAuditLog'
      | 'retentionJob'
      | 'notification'
    >,
    studyUid: string,
    actor: DeletionActor,
  ): Promise<CollectedStudy> {
    const study = await db.study.findUnique({
      where: { studyInstanceUid: studyUid },
      include: { patient: true },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);
    this.assertStudyScope(actor, study.hospitalId);
    if (study.patient.hospitalId !== study.hospitalId) {
      throw new ConflictException('The study and patient belong to different hospitals');
    }
    const hospital = await db.hospital.findUnique({
      where: { id: study.hospitalId },
      select: { name: true },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');

    const reportIdsQuery = await db.report.findMany({
      where: { studyId: study.id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const reportIds = reportIdsQuery.map((report) => report.id);
    const retention = await db.studyRetention.findUnique({
      where: { studyId: study.id },
    });
    const [
      series,
      instances,
      worklistItems,
      reports,
      reportVersions,
      assignments,
      changeRequests,
      deliveryAttempts,
      aiJobs,
      reportImages,
      historyAttachments,
      retentionNotifications,
      retentionAuditLogs,
      retentionJobs,
      notifications,
      otherPatientStudies,
    ] = await Promise.all([
      db.series.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.instance.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.worklistItem.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.report.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      reportIds.length
        ? db.reportVersion.findMany({
            where: { reportId: { in: reportIds } },
            orderBy: { id: 'asc' },
          })
        : Promise.resolve([]),
      db.assignment.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.changeRequest.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.deliveryAttempt.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.aIJob.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.reportImage.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.studyHistoryAttachment.findMany({
        where: { studyId: study.id },
        orderBy: { id: 'asc' },
      }),
      db.retentionNotification.findMany({
        where: { studyId: study.id },
        orderBy: { id: 'asc' },
      }),
      db.retentionAuditLog.findMany({
        where: retention
          ? { OR: [{ studyId: study.id }, { retentionId: retention.id }] }
          : { studyId: study.id },
        orderBy: { id: 'asc' },
      }),
      db.retentionJob.findMany({
        where: retention
          ? { OR: [{ studyId: study.id }, { retentionId: retention.id }] }
          : { studyId: study.id },
        orderBy: { id: 'asc' },
      }),
      db.notification.findMany({ where: { studyId: study.id }, orderBy: { id: 'asc' } }),
      db.study.count({
        where: { patientId: study.patientId, id: { not: study.id } },
      }),
    ]);

    const { patient, ...studyFields } = study;
    const records: Record<string, unknown> = {
      Patient: otherPatientStudies === 0 ? [patient] : [],
      Study: [studyFields],
      Series: series,
      Instance: instances,
      WorklistItem: worklistItems,
      Report: reports,
      ReportVersion: reportVersions,
      Assignment: assignments,
      ChangeRequest: changeRequests,
      DeliveryAttempt: deliveryAttempts,
      AIJob: aiJobs,
      ReportImage: reportImages,
      StudyHistoryAttachment: historyAttachments,
      StudyRetention: retention ? [retention] : [],
      RetentionNotification: retentionNotifications,
      RetentionAuditLog: retentionAuditLogs,
      RetentionJob: retentionJobs,
      Notification: notifications,
    };
    const fileRows = [
      ...reportImages.map((item) => ({
        kind: 'report-image' as const,
        storageKey: item.storageKey,
      })),
      ...historyAttachments.map((item) => ({
        kind: 'study-history' as const,
        storageKey: item.storageKey,
      })),
    ];

    return {
      patientRecordId: patient.id,
      hospitalName: hospital.name,
      patientShouldDelete: otherPatientStudies === 0,
      records,
      fileRows,
      studyUid: study.studyInstanceUid,
      studyId: study.id,
      hospitalId: study.hospitalId,
      accessionNumber: study.accessionNumber,
      patientId: patient.patientId,
      patientName: patient.displayName,
      instanceCount: instances.length,
    };
  }

  private async deleteGraph(
    tx: Prisma.TransactionClient,
    collected: CollectedStudy,
  ): Promise<void> {
    const reportIds = rowsFrom(collected.records.Report)
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string');
    await tx.aIJob.deleteMany({ where: { studyId: collected.studyId } });
    await tx.deliveryAttempt.deleteMany({ where: { studyId: collected.studyId } });
    await tx.changeRequest.deleteMany({ where: { studyId: collected.studyId } });
    await tx.reportImage.deleteMany({ where: { studyId: collected.studyId } });
    await tx.studyHistoryAttachment.deleteMany({ where: { studyId: collected.studyId } });
    if (reportIds.length) {
      await tx.reportVersion.deleteMany({ where: { reportId: { in: reportIds } } });
      await tx.report.deleteMany({ where: { id: { in: reportIds } } });
    }
    await tx.assignment.deleteMany({ where: { studyId: collected.studyId } });
    await tx.instance.deleteMany({ where: { studyId: collected.studyId } });
    await tx.series.deleteMany({ where: { studyId: collected.studyId } });
    await tx.worklistItem.deleteMany({ where: { studyId: collected.studyId } });
    await tx.notification.deleteMany({ where: { studyId: collected.studyId } });
    await tx.retentionNotification.deleteMany({ where: { studyId: collected.studyId } });
    const retentionId = rowsFrom(collected.records.StudyRetention)[0]?.id;
    await tx.retentionJob.deleteMany({
      where: retentionId
        ? { OR: [{ studyId: collected.studyId }, { retentionId: String(retentionId) }] }
        : { studyId: collected.studyId },
    });
    await tx.retentionAuditLog.deleteMany({
      where: retentionId
        ? { OR: [{ studyId: collected.studyId }, { retentionId: String(retentionId) }] }
        : { studyId: collected.studyId },
    });
    await tx.studyRetention.deleteMany({ where: { studyId: collected.studyId } });
    await tx.study.delete({ where: { id: collected.studyId } });
    if (collected.patientShouldDelete) {
      await tx.patient.delete({ where: { id: collected.patientRecordId } });
    }
  }

  private async archiveFilesToStorage(
    fileRows: CollectedStudy['fileRows'],
    archivePrefix: string,
    scratchDir: string,
    archiveId: string,
  ): Promise<ArchiveFile[]> {
    const result: ArchiveFile[] = [];
    for (const file of fileRows) {
      if (
        path.basename(file.storageKey) !== file.storageKey ||
        !/^[A-Za-z0-9._-]{1,255}$/.test(file.storageKey)
      ) {
        throw new Error('A related file has an invalid storage key');
      }
      const sourceDir =
        file.kind === 'report-image'
          ? process.env.AXIS_REPORT_IMAGE_DIR ??
            path.join(process.cwd(), 'uploads', 'report-images')
          : process.env.AXIS_STUDY_HISTORY_DIR ??
            path.join(process.cwd(), 'uploads', 'study-history');
      const sourcePath = path.join(sourceDir, file.storageKey);
      const bytes = await fs.readFile(sourcePath);
      const checksum = sha256(bytes);
      const tempPath = path.join(scratchDir, `${result.length}.file`);
      await fs.writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 });
      const objectKey = this.objectKey(
        resolveBackupEnv(),
        archivePrefix,
        `files/${file.kind}/${file.storageKey}`,
      );
      await this.putArtifact(tempPath, objectKey, archiveId, checksum);
      result.push({ ...file, objectKey, checksum });
    }
    return result;
  }

  private async putArtifact(
    sourcePath: string,
    objectKey: string,
    archiveId: string,
    checksum: string,
  ): Promise<void> {
    const metadata = {
      backupRunId: archiveId,
      artifact: 'manual-deletion' as const,
      checksum,
      createdAt: new Date().toISOString(),
    };
    if (this.storage.remote) {
      await this.storage.upload(sourcePath, objectKey, metadata);
      if (!(await this.storage.verify(objectKey, sourcePath, checksum))) {
        throw new Error('S3 archive verification failed');
      }
      return;
    }
    await fs.mkdir(path.dirname(objectKey), { recursive: true, mode: 0o700 });
    await fs.copyFile(sourcePath, objectKey);
    if ((await verifyChecksum(objectKey, checksum)) === false) {
      throw new Error('Local archive verification failed');
    }
  }

  private archivePrefix(
    env: ReturnType<typeof resolveBackupEnv>,
    hospitalId: string,
    archiveId: string,
  ): string {
    const suffix = `manual-deletions/${encodeURIComponent(hospitalId)}/${encodeURIComponent(archiveId)}`;
    return this.storage.remote ? `${env.b2Prefix}/${suffix}` : path.join(env.backupDir, suffix);
  }

  private objectKey(
    env: ReturnType<typeof resolveBackupEnv>,
    prefix: string,
    filename: string,
  ): string {
    return this.storage.remote
      ? `${prefix}/${filename}`
      : path.join(prefix, ...filename.split('/'));
  }

  private async downloadSnapshot(
    archive: {
      id: string;
      hospitalId: string;
      studyInstanceUid: string;
      metadataObjectKey: string | null;
      metadataChecksum: string | null;
    },
  ): Promise<StudySnapshot> {
    if (!archive.metadataObjectKey || !archive.metadataChecksum) {
      throw new BadRequestException('The archive metadata is incomplete');
    }
    const env = resolveBackupEnv();
    const scratchDir = await this.createScratchDirectory(env, 'manual-restore-');
    const localPath = path.join(scratchDir, 'metadata.json');
    try {
      await this.storage.download(archive.metadataObjectKey, localPath);
      if (!(await verifyChecksum(localPath, archive.metadataChecksum))) {
        throw new BadRequestException('The archived metadata failed checksum validation');
      }
      const parsed: unknown = JSON.parse(await fs.readFile(localPath, 'utf8'));
      if (
        !isRecord(parsed) ||
        parsed.version !== 1 ||
        parsed.archiveId !== archive.id ||
        parsed.hospitalId !== archive.hospitalId ||
        parsed.studyInstanceUid !== archive.studyInstanceUid ||
        !isRecord(parsed.records) ||
        !Array.isArray(parsed.files)
      ) {
        throw new BadRequestException('The archive metadata is invalid or belongs elsewhere');
      }
      return parsed as unknown as StudySnapshot;
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  }

  private async restoreDicom(
    archive: {
      dicomObjectKey: string | null;
      dicomChecksum: string | null;
    },
    payload: StudySnapshot,
  ) {
    if (!archive.dicomObjectKey && !archive.dicomChecksum) return null;
    if (!archive.dicomObjectKey || !archive.dicomChecksum) {
      throw new BadRequestException('The DICOM archive metadata is incomplete');
    }
    const env = resolveBackupEnv();
    const scratchDir = await this.createScratchDirectory(env, 'manual-dicom-restore-');
    const localPath = path.join(scratchDir, 'study-dicom.tar.gz');
    try {
      await this.storage.download(archive.dicomObjectKey, localPath);
      return await restoreDicomArchiveObjects(
        localPath,
        archive.dicomChecksum,
        env,
      );
    } catch (error) {
      throw new BadRequestException(
        `The archived DICOM data could not be restored: ${this.safeError(error)}`,
      );
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  }

  private archiveFiles(value: Prisma.JsonValue | null): ArchiveFile[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (
        !isRecord(item) ||
        (item.kind !== 'report-image' && item.kind !== 'study-history') ||
        typeof item.storageKey !== 'string' ||
        typeof item.objectKey !== 'string' ||
        typeof item.checksum !== 'string'
      ) {
        throw new BadRequestException('The archived file manifest is invalid');
      }
      return {
        kind: item.kind,
        storageKey: item.storageKey,
        objectKey: item.objectKey,
        checksum: item.checksum,
      };
    });
  }

  private async restoreFiles(files: ArchiveFile[]): Promise<void> {
    const env = resolveBackupEnv();
    const scratchDir = await this.createScratchDirectory(env, 'manual-files-restore-');
    try {
      for (const file of files) {
        if (
          path.basename(file.storageKey) !== file.storageKey ||
          !/^[A-Za-z0-9._-]{1,255}$/.test(file.storageKey)
        ) {
          throw new BadRequestException('The archived file path is invalid');
        }
        const localPath = path.join(scratchDir, `${file.storageKey}.tmp`);
        await this.storage.download(file.objectKey, localPath);
        if (!(await verifyChecksum(localPath, file.checksum))) {
          throw new BadRequestException('An archived supporting file failed checksum validation');
        }
        const targetDir =
          file.kind === 'report-image'
            ? process.env.AXIS_REPORT_IMAGE_DIR ??
              path.join(process.cwd(), 'uploads', 'report-images')
            : process.env.AXIS_STUDY_HISTORY_DIR ??
              path.join(process.cwd(), 'uploads', 'study-history');
        await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });
        const target = path.join(targetDir, file.storageKey);
        try {
          await fs.copyFile(localPath, target, fsConstants.COPYFILE_EXCL);
        } catch (error) {
          if (
            !isRecord(error) ||
            error.code !== 'EEXIST' ||
            !(await verifyChecksum(target, file.checksum))
          ) {
            throw error;
          }
        }
      }
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  }

  private async removeOriginalFiles(fileRows: CollectedStudy['fileRows']) {
    for (const file of fileRows) {
      const directory =
        file.kind === 'report-image'
          ? process.env.AXIS_REPORT_IMAGE_DIR ??
            path.join(process.cwd(), 'uploads', 'report-images')
          : process.env.AXIS_STUDY_HISTORY_DIR ??
            path.join(process.cwd(), 'uploads', 'study-history');
      await fs.unlink(path.join(directory, file.storageKey));
    }
  }

  private async createScratchDirectory(
    env: ReturnType<typeof resolveBackupEnv>,
    prefix: string,
  ): Promise<string> {
    await fs.mkdir(env.backupDir, { recursive: true, mode: 0o700 });
    return fs.mkdtemp(path.join(env.backupDir, prefix));
  }

  private applyDicomMappings(
    records: Record<string, unknown>,
    dicom: Awaited<ReturnType<typeof restoreDicomArchiveObjects>> | null,
  ): Record<string, unknown> {
    if (!dicom) return records;
    const studies = rowsFrom(records.Study);
    const seriesRows = rowsFrom(records.Series);
    const instanceRows = rowsFrom(records.Instance);
    for (const mapping of dicom.mappings.studies) {
      const study = studies.find((row) => row.studyInstanceUid === mapping.studyInstanceUid);
      if (!study) throw new BadRequestException('DICOM archive study does not match metadata');
      study.orthancStudyId = mapping.orthancStudyId;
      study.orthancPatientId = mapping.orthancPatientId;
      for (const seriesMapping of mapping.series) {
        const series = seriesRows.find(
          (row) => row.seriesInstanceUid === seriesMapping.seriesInstanceUid,
        );
        if (!series) throw new BadRequestException('DICOM series does not match metadata');
        series.orthancSeriesId = seriesMapping.orthancSeriesId;
        for (const instanceMapping of seriesMapping.instances) {
          const instance = instanceRows.find(
            (row) => row.sopInstanceUid === instanceMapping.sopInstanceUid,
          );
          if (!instance) throw new BadRequestException('DICOM instance does not match metadata');
          instance.orthancInstanceId = instanceMapping.orthancInstanceId;
        }
      }
    }
    return records;
  }

  private async assertPatientReady(
    tx: Prisma.TransactionClient,
    records: Record<string, unknown>,
    patientShouldDelete: boolean,
  ) {
    const study = rowsFrom(records.Study)[0];
    const patientId = study?.patientId;
    if (typeof patientId !== 'string') {
      throw new BadRequestException('The archived study has no patient relationship');
    }
    const patient = await tx.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (patientShouldDelete && patient) {
      throw new ConflictException('The original patient identifier is already in use');
    }
    if (!patientShouldDelete && !patient) {
      throw new ConflictException('The shared patient record no longer exists');
    }
  }

  private async insertRows(
    tx: Prisma.TransactionClient,
    table: (typeof SNAPSHOT_TABLES)[number],
    value: unknown,
  ) {
    const rows = rowsFrom(value);
    if (!rows.length) return;
    const json = JSON.stringify(rows);
    switch (table) {
      case 'Patient':
        await tx.$executeRaw`INSERT INTO "Patient" SELECT * FROM jsonb_populate_recordset(NULL::"Patient", ${json}::jsonb)`;
        break;
      case 'Study':
        await tx.$executeRaw`INSERT INTO "Study" SELECT * FROM jsonb_populate_recordset(NULL::"Study", ${json}::jsonb)`;
        break;
      case 'Series':
        await tx.$executeRaw`INSERT INTO "Series" SELECT * FROM jsonb_populate_recordset(NULL::"Series", ${json}::jsonb)`;
        break;
      case 'Instance':
        await tx.$executeRaw`INSERT INTO "Instance" SELECT * FROM jsonb_populate_recordset(NULL::"Instance", ${json}::jsonb)`;
        break;
      case 'WorklistItem':
        await tx.$executeRaw`INSERT INTO "WorklistItem" SELECT * FROM jsonb_populate_recordset(NULL::"WorklistItem", ${json}::jsonb)`;
        break;
      case 'Report':
        await tx.$executeRaw`INSERT INTO "Report" SELECT * FROM jsonb_populate_recordset(NULL::"Report", ${json}::jsonb)`;
        break;
      case 'ReportVersion':
        await tx.$executeRaw`INSERT INTO "ReportVersion" SELECT * FROM jsonb_populate_recordset(NULL::"ReportVersion", ${json}::jsonb)`;
        break;
      case 'Assignment':
        await tx.$executeRaw`INSERT INTO "Assignment" SELECT * FROM jsonb_populate_recordset(NULL::"Assignment", ${json}::jsonb)`;
        break;
      case 'ChangeRequest':
        await tx.$executeRaw`INSERT INTO "ChangeRequest" SELECT * FROM jsonb_populate_recordset(NULL::"ChangeRequest", ${json}::jsonb)`;
        break;
      case 'DeliveryAttempt':
        await tx.$executeRaw`INSERT INTO "DeliveryAttempt" SELECT * FROM jsonb_populate_recordset(NULL::"DeliveryAttempt", ${json}::jsonb)`;
        break;
      case 'AIJob':
        await tx.$executeRaw`INSERT INTO "AIJob" SELECT * FROM jsonb_populate_recordset(NULL::"AIJob", ${json}::jsonb)`;
        break;
      case 'ReportImage':
        await tx.$executeRaw`INSERT INTO "ReportImage" SELECT * FROM jsonb_populate_recordset(NULL::"ReportImage", ${json}::jsonb)`;
        break;
      case 'StudyHistoryAttachment':
        await tx.$executeRaw`INSERT INTO "StudyHistoryAttachment" SELECT * FROM jsonb_populate_recordset(NULL::"StudyHistoryAttachment", ${json}::jsonb)`;
        break;
      case 'StudyRetention':
        await tx.$executeRaw`INSERT INTO "StudyRetention" SELECT * FROM jsonb_populate_recordset(NULL::"StudyRetention", ${json}::jsonb)`;
        break;
      case 'RetentionNotification':
        await tx.$executeRaw`INSERT INTO "RetentionNotification" SELECT * FROM jsonb_populate_recordset(NULL::"RetentionNotification", ${json}::jsonb)`;
        break;
      case 'RetentionAuditLog':
        await tx.$executeRaw`INSERT INTO "RetentionAuditLog" SELECT * FROM jsonb_populate_recordset(NULL::"RetentionAuditLog", ${json}::jsonb)`;
        break;
      case 'RetentionJob':
        await tx.$executeRaw`INSERT INTO "RetentionJob" SELECT * FROM jsonb_populate_recordset(NULL::"RetentionJob", ${json}::jsonb)`;
        break;
      case 'Notification':
        await tx.$executeRaw`INSERT INTO "Notification" SELECT * FROM jsonb_populate_recordset(NULL::"Notification", ${json}::jsonb)`;
        break;
    }
  }

  private async deleteArchivedObject(key: string) {
    if (!(await this.storage.head(key))) return;
    if (this.storage.purgeVersions) {
      await this.storage.purgeVersions(key);
    } else {
      await this.storage.delete(key);
    }
    const purged = this.storage.verifyPurge
      ? await this.storage.verifyPurge(key)
      : (await this.storage.head(key)) === null;
    if (!purged) throw new Error('An archived object could not be permanently deleted');
  }

  private async loadArchive(id: string, actor: DeletionActor) {
    const archive = await this.prisma.manualDeletionArchive.findUnique({
      where: { id },
    });
    if (!archive) throw new NotFoundException('Archive not found');
    this.assertStudyScope(actor, archive.hospitalId);
    return archive;
  }

  private assertManagerScope(actor: DeletionActor) {
    if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only ADMIN or MANAGER may manage manual deletions');
    }
    if (actor.role === UserRole.MANAGER && !actor.hospitalId) {
      throw new ForbiddenException('Your manager account is not linked to a hospital');
    }
  }

  private assertStudyScope(actor: DeletionActor, hospitalId: string) {
    this.assertManagerScope(actor);
    if (actor.role === UserRole.MANAGER && actor.hospitalId !== hospitalId) {
      throw new NotFoundException('Study not found');
    }
  }

  private requiredRowId(records: Record<string, unknown>, table: string): string {
    const id = rowsFrom(records[table])[0]?.id;
    if (typeof id !== 'string') {
      throw new BadRequestException('The archive is missing a required record identifier');
    }
    return id;
  }

  private safeError(error: unknown): string {
    return error instanceof HttpException
      ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 1000)
      : 'Operation failed; retry or contact an administrator';
  }

  private publicError(error: unknown): string {
    return error instanceof HttpException
      ? error.message
      : 'Archive operation failed; active records were not confirmed deleted';
  }
}
