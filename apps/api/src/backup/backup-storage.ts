import { promises as fs, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { BackupEnv } from './backup-ops.js';
import { assertB2Config, verifyChecksum } from './backup-ops.js';

export const BACKUP_STORAGE = Symbol('BACKUP_STORAGE');

export interface ArtifactMetadata {
  backupRunId: string;
  artifact: 'database' | 'dicom' | 'retention';
  checksum: string;
  createdAt: string;
}

export interface RemoteArtifact {
  key: string;
  sizeBytes: string;
  checksum?: string;
  etag?: string;
  lastModified?: string;
}

export interface BackupStorage {
  readonly remote: boolean;
  upload(filePath: string, key: string, metadata: ArtifactMetadata): Promise<void>;
  download(key: string, filePath: string): Promise<void>;
  head(key: string): Promise<RemoteArtifact | null>;
  list(prefix: string): Promise<RemoteArtifact[]>;
  delete(key: string): Promise<void>;
  purgeVersions?(key: string): Promise<number>;
  verifyPurge?(key: string): Promise<boolean>;
  verify(key: string, filePath: string, expectedChecksum: string): Promise<boolean>;
}

export class B2BackupStorage implements BackupStorage {
  readonly remote = true;
  private readonly client: S3Client;

  constructor(private readonly env: BackupEnv) {
    assertB2Config(env);
    this.client = new S3Client({
      region: env.b2Region,
      endpoint: env.b2Endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.b2KeyId as string,
        secretAccessKey: env.b2ApplicationKey as string,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async upload(filePath: string, key: string, metadata: ArtifactMetadata): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.env.b2BucketName,
        Key: key,
        Body: createReadStream(filePath),
        Metadata: {
          'backup-run-id': metadata.backupRunId,
          artifact: metadata.artifact,
          sha256: metadata.checksum,
          'created-at': metadata.createdAt,
        },
      },
      queueSize: 4,
      partSize: 16 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async download(key: string, filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.env.b2BucketName, Key: key }),
    );
    if (!result.Body) throw new Error(`B2 object ${key} returned an empty body`);
    await pipeline(result.Body as Readable, createWriteStream(filePath));
  }

  async head(key: string): Promise<RemoteArtifact | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.env.b2BucketName, Key: key }),
      );
      return {
        key,
        sizeBytes: String(result.ContentLength ?? 0),
        checksum: result.Metadata?.sha256,
        etag: result.ETag,
        lastModified: result.LastModified?.toISOString(),
      };
    } catch (err) {
      if (['NotFound', 'NoSuchKey', '404'].includes((err as Error).name)) return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<RemoteArtifact[]> {
    const artifacts: RemoteArtifact[] = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.env.b2BucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of result.Contents ?? []) {
        if (!object.Key) continue;
        artifacts.push({
          key: object.Key,
          sizeBytes: String(object.Size ?? 0),
          etag: object.ETag,
          lastModified: object.LastModified?.toISOString(),
        });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return artifacts;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.env.b2BucketName, Key: key }),
    );
  }

  async purgeVersions(key: string): Promise<number> {
    let removed = 0;
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const versions = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.env.b2BucketName,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      for (const version of versions.Versions ?? []) {
        if (version.Key !== key || !version.VersionId) continue;
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.env.b2BucketName,
            Key: key,
            VersionId: version.VersionId,
          }),
        );
        removed += 1;
      }
      for (const marker of versions.DeleteMarkers ?? []) {
        if (marker.Key !== key || !marker.VersionId) continue;
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.env.b2BucketName,
            Key: key,
            VersionId: marker.VersionId,
          }),
        );
        removed += 1;
      }
      keyMarker = versions.IsTruncated
        ? versions.NextKeyMarker ?? key
        : undefined;
      versionIdMarker = versions.IsTruncated
        ? versions.NextVersionIdMarker
        : undefined;
    } while (keyMarker);

    let uploadKeyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const uploads = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.env.b2BucketName,
          Prefix: key,
          KeyMarker: uploadKeyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      for (const upload of uploads.Uploads ?? []) {
        if (upload.Key !== key || !upload.UploadId) continue;
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.env.b2BucketName,
            Key: key,
            UploadId: upload.UploadId,
          }),
        );
        removed += 1;
      }
      uploadKeyMarker = uploads.IsTruncated ? uploads.NextKeyMarker : undefined;
      uploadIdMarker = uploads.IsTruncated ? uploads.NextUploadIdMarker : undefined;
    } while (uploadKeyMarker);

    return removed;
  }

  async verifyPurge(key: string): Promise<boolean> {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const versions = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.env.b2BucketName,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      const hasObject = [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])].some(
        (item) => item.Key === key,
      );
      if (hasObject) return false;
      if (!versions.IsTruncated) break;
      keyMarker = versions.NextKeyMarker;
      versionIdMarker = versions.NextVersionIdMarker;
      if (!keyMarker && !versionIdMarker) break;
    } while (keyMarker || versionIdMarker);

    let uploadKeyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const uploads = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.env.b2BucketName,
          Prefix: key,
          KeyMarker: uploadKeyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      if ((uploads.Uploads ?? []).some((upload) => upload.Key === key)) return false;
      if (!uploads.IsTruncated) break;
      uploadKeyMarker = uploads.NextKeyMarker;
      uploadIdMarker = uploads.NextUploadIdMarker;
      if (!uploadKeyMarker && !uploadIdMarker) break;
    } while (uploadKeyMarker || uploadIdMarker);

    return true;
  }

  async verify(key: string, filePath: string, expectedChecksum: string): Promise<boolean> {
    const remote = await this.head(key);
    if (!remote || !remote.checksum || remote.checksum !== expectedChecksum) return false;
    const scratchDir = await fs.mkdtemp(path.join(this.env.backupDir, 'verify-'));
    const scratchFile = path.join(scratchDir, 'artifact');
    try {
      await this.download(key, scratchFile);
      return (
        remote.sizeBytes === (await fs.stat(scratchFile)).size.toString() &&
        (await verifyChecksum(scratchFile, expectedChecksum))
      );
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  }
}

export class LocalBackupStorage implements BackupStorage {
  readonly remote = false;

  constructor(private readonly env: BackupEnv) {}

  async upload(): Promise<void> {
    return undefined;
  }

  async download(key: string, filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.copyFile(key, filePath);
  }

  async head(key: string): Promise<RemoteArtifact | null> {
    try {
      const stat = await fs.stat(key);
      return {
        key,
        sizeBytes: String(stat.size),
        lastModified: stat.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<RemoteArtifact[]> {
    try {
      const names = await fs.readdir(prefix);
      const results = await Promise.all(
        names.map((name) => this.head(path.join(prefix, name))),
      );
      return results.filter((item): item is RemoteArtifact => item !== null);
    } catch {
      return [];
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(key, { force: true });
  }

  async verifyPurge(key: string): Promise<boolean> {
    return (await this.head(key)) === null;
  }

  async verify(_key: string, filePath: string, expectedChecksum: string): Promise<boolean> {
    return verifyChecksum(filePath, expectedChecksum);
  }
}

export function createBackupStorage(env: BackupEnv): BackupStorage {
  return env.provider === 'B2' ? new B2BackupStorage(env) : new LocalBackupStorage(env);
}
