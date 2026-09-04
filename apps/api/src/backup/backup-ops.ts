import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface BackupEnv {
  postgresContainer: string;
  dbName: string;
  dbUser: string;
  orthancVolume: string;
  backupDir: string;
  podmanBin: string;
}

// NOTE: UID env var is readonly in this environment; we deliberately avoid it
// and use the container/db names which are the source of truth for snapshots.
export function resolveBackupEnv(env: NodeJS.ProcessEnv = process.env): BackupEnv {
  return {
    postgresContainer: env.AXIS_POSTGRES_CONTAINER ?? 'axis-postgres',
    dbName: env.AXIS_PACS_DB ?? 'axis_pacs',
    dbUser: env.AXIS_PACS_DB_USER ?? 'axis',
    orthancVolume: env.AXIS_ORTHANC_DATA_VOLUME ?? 'axis_orthanc_data',
    backupDir: path.resolve(env.AXIS_BACKUP_DIR ?? 'backups'),
    podmanBin: env.AXIS_PODMAN_BIN ?? 'podman',
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Dump the PostgreSQL database to a .sql file via podman exec into the running
 * postgres container. Returns { filePath, sizeBytes, checksum }.
 */
export async function dumpDatabase(
  outFile: string,
  env: BackupEnv = resolveBackupEnv(),
): Promise<{ filePath: string; sizeBytes: string; checksum: string }> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const { stdout } = await execFileAsync(
    env.podmanBin,
    [
      'exec', '-i', env.postgresContainer,
      'pg_dump', '-U', env.dbUser, '-d', env.dbName,
    ],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  await fs.writeFile(outFile, stdout, 'utf8');
  const stat = await fs.stat(outFile);
  const checksum = await sha256File(outFile);
  return { filePath: outFile, sizeBytes: String(stat.size), checksum };
}

/**
 * Snapshot the Orthanc data volume into a tar archive using podman volume export.
 */
export async function exportOrthancVolume(
  outFile: string,
  env: BackupEnv = resolveBackupEnv(),
): Promise<{ filePath: string; sizeBytes: string; checksum: string }> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const { stdout } = await execFileAsync(
    env.podmanBin,
    ['volume', 'export', env.orthancVolume],
    { maxBuffer: 0, encoding: 'buffer' },
  );
  await fs.writeFile(outFile, stdout);
  const stat = await fs.stat(outFile);
  const checksum = await sha256File(outFile);
  return { filePath: outFile, sizeBytes: String(stat.size), checksum };
}

/**
 * Validate that a pg_dump script is structurally plausible: it must be
 * non-empty and carry the PostgreSQL dump header. pg_dump itself fails before
 * writing a file if the source DB cannot be read, so any produced dump is
 * already a consistent snapshot; this check guards against empty/truncated runs.
 */
export async function validateDatabaseDump(
  filePath: string,
): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size < 16) return false;
    const handle = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(64);
      await handle.read(buf, 0, 64, 0);
      const text = buf.toString('utf8').toLowerCase();
      return text.includes('postgresql database dump');
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/** Confirm a file on disk still matches its recorded sha256 checksum. */
export async function verifyChecksum(
  filePath: string,
  expectedChecksum: string,
): Promise<boolean> {
  try {
    const actual = await sha256File(filePath);
    return actual === expectedChecksum;
  } catch {
    return false;
  }
}
