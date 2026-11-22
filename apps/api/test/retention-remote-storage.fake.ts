import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { sha256File } from '../src/backup/backup-ops.js';
import type {
  ArtifactMetadata,
  BackupStorage,
  RemoteArtifact,
} from '../src/backup/backup-storage.js';

export interface FakeRemoteUpload {
  filePath: string;
  key: string;
  metadata: ArtifactMetadata;
  sha256: string;
}

export interface FakeRemoteVerification {
  key: string;
  filePath: string;
  expectedChecksum: string;
}

export class FakeRemoteBackupStorage implements BackupStorage {
  readonly remote = true;
  readonly uploads: FakeRemoteUpload[] = [];
  readonly verifications: FakeRemoteVerification[] = [];

  private readonly objects = new Map<string, Buffer>();
  private readonly checksums = new Map<string, string>();

  async upload(filePath: string, key: string, metadata: ArtifactMetadata): Promise<void> {
    const contents = await fs.readFile(filePath);
    this.objects.set(key, Buffer.from(contents));
    this.checksums.set(key, metadata.checksum);
    this.uploads.push({
      filePath,
      key,
      metadata,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  }

  async download(key: string, filePath: string): Promise<void> {
    const contents = this.objects.get(key);
    if (!contents) throw new Error(`Fake object not found: ${key}`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents);
  }

  async head(key: string): Promise<RemoteArtifact | null> {
    const contents = this.objects.get(key);
    if (!contents) return null;
    return {
      key,
      sizeBytes: String(contents.length),
      checksum: this.checksums.get(key),
    };
  }

  async list(prefix: string): Promise<RemoteArtifact[]> {
    const artifacts: RemoteArtifact[] = [];
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        artifacts.push((await this.head(key)) as RemoteArtifact);
      }
    }
    return artifacts;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
    this.checksums.delete(key);
  }

  async verify(key: string, filePath: string, expectedChecksum: string): Promise<boolean> {
    this.verifications.push({ key, filePath, expectedChecksum });
    const localChecksum = await sha256File(filePath);
    return this.checksums.get(key) === expectedChecksum && localChecksum === expectedChecksum;
  }

  uploadFor(key: string): FakeRemoteUpload | undefined {
    return this.uploads.find((upload) => upload.key === key);
  }

  contentFor(key: string): Buffer | undefined {
    return this.objects.get(key);
  }

  reset(): void {
    this.uploads.length = 0;
    this.verifications.length = 0;
    this.objects.clear();
    this.checksums.clear();
  }
}
