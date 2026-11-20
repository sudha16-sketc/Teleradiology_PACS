import { execFile, spawn } from 'child_process';
import { createHash, type Hash } from 'crypto';
import { promises as fs } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import { Writable } from 'stream';
import { createGunzip, createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export type BackupStorageProvider = 'LOCAL' | 'B2';

export interface BackupEnv {
  postgresContainer: string;
  dbName: string;
  dbUser: string;
  orthancVolume: string;
  backupDir: string;
  podmanBin: string;
  pgDumpBin: string;
  pgRestoreBin: string;
  databaseUrl: string;
  provider: BackupStorageProvider;
  environment: string;
  b2KeyId?: string;
  b2ApplicationKey?: string;
  b2BucketName: string;
  b2Endpoint: string;
  b2Region: string;
  b2Prefix: string;
  b2RetentionEnabled: boolean;
  b2RetentionCount: number;
  orthancUrl: string;
  orthancUsername?: string;
  orthancPassword?: string;
}

export interface ArtifactResult {
  filePath: string;
  sizeBytes: string;
  checksum: string;
}

export function resolveBackupEnv(env: NodeJS.ProcessEnv = process.env): BackupEnv {
  const explicitProvider = String(env.BACKUP_STORAGE_PROVIDER ?? '').trim().toUpperCase();
  const provider: BackupStorageProvider =
    explicitProvider === 'B2' || explicitProvider === 'LOCAL'
      ? explicitProvider
      : env.B2_KEY_ID && env.B2_APPLICATION_KEY
        ? 'B2'
        : 'LOCAL';
  const retentionCount = Number.parseInt(env.BACKUP_RETENTION_COUNT ?? '7', 10);

  return {
    postgresContainer: env.AXIS_POSTGRES_CONTAINER ?? 'axis-postgres',
    dbName: env.AXIS_PACS_DB ?? 'axis_pacs',
    dbUser: env.AXIS_PACS_DB_USER ?? 'axis',
    orthancVolume: env.AXIS_ORTHANC_DATA_VOLUME ?? 'axis_orthanc_data',
    backupDir: path.resolve(env.AXIS_BACKUP_DIR ?? 'backups'),
    podmanBin: env.AXIS_PODMAN_BIN ?? 'podman',
    pgDumpBin: env.PG_DUMP_BIN ?? 'pg_dump',
    pgRestoreBin: env.PG_RESTORE_BIN ?? 'pg_restore',
    databaseUrl: env.DATABASE_URL ?? '',
    provider,
    environment:
      env.AXIS_ENV ?? env.NODE_ENV ?? 'development',
    b2KeyId: env.B2_KEY_ID,
    b2ApplicationKey: env.B2_APPLICATION_KEY,
    b2BucketName: env.B2_BUCKET_NAME ?? 'teleradiology-pacs',
    b2Endpoint:
      env.B2_S3_ENDPOINT ?? 'https://s3.us-east-005.backblazeb2.com',
    b2Region: env.B2_REGION ?? 'us-east-005',
    b2Prefix: (env.B2_PREFIX ?? 'backups').replace(/^\/+|\/+$/g, ''),
    b2RetentionEnabled:
      String(env.BACKUP_RETENTION_ENABLED ?? 'true').toLowerCase() !== 'false',
    b2RetentionCount:
      Number.isFinite(retentionCount) && retentionCount > 0 ? retentionCount : 7,
    orthancUrl: env.ORTHANC_URL ?? 'http://localhost:8042',
    orthancUsername: env.ORTHANC_USERNAME,
    orthancPassword: env.ORTHANC_PASSWORD,
  };
}

export function assertB2Config(env: BackupEnv): void {
  const missing: string[] = [];
  if (!env.b2KeyId) missing.push('B2_KEY_ID');
  if (!env.b2ApplicationKey) missing.push('B2_APPLICATION_KEY');
  if (!env.b2BucketName) missing.push('B2_BUCKET_NAME');
  if (!env.b2Endpoint) missing.push('B2_S3_ENDPOINT');
  if (!env.b2Region) missing.push('B2_REGION');
  if (missing.length) {
    throw new Error(
      `Backblaze B2 backup is missing required environment variables: ${missing.join(', ')}`,
    );
  }
}

export function backupObjectKey(
  env: BackupEnv,
  runId: string,
  timestamp: string,
  kind: 'database' | 'dicom',
): string {
  const name =
    kind === 'database'
      ? `db_${runId}_${timestamp}.dump.gz`
      : `dicom_${runId}_${timestamp}.tar.gz`;
  const prefix = env.b2Prefix ? `${env.b2Prefix}/` : '';
  return `${prefix}${env.environment}/${runId}/${name}`;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hashWriter(hash));
  return hash.digest('hex');
}

function hashWriter(hash: Hash): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  });
}

function parsePgConnection(rawUrl: string): {
  host: string;
  port: string;
  user: string;
  database: string;
  password: string;
} {
  if (!rawUrl) {
    throw new Error(
      'DATABASE_URL is required for direct PostgreSQL backups (set it to the production connection string)',
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection string');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
  try {
    return {
      host: decodeURIComponent(url.hostname),
      port: url.port || '5432',
      user: decodeURIComponent(url.username),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      password: decodeURIComponent(url.password),
    };
  } catch {
    throw new Error('DATABASE_URL contains invalid percent-encoded credentials');
  }
}

function pgArgs(
  connection: ReturnType<typeof parsePgConnection>,
  extra: string[] = [],
): string[] {
  return [
    '--host',
    connection.host,
    '--port',
    connection.port,
    '--username',
    connection.user,
    '--dbname',
    connection.database,
    ...extra,
  ];
}

function pgEnv(connection: ReturnType<typeof parsePgConnection>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGPASSWORD: connection.password,
    PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? '15',
  };
}

function sanitizePgError(message: string, password: string): string {
  let safe = message;
  if (password) safe = safe.split(password).join('***');
  return safe.slice(0, 2000).trim() || 'PostgreSQL client command failed';
}

export async function dumpDatabase(
  outFile: string,
  env: BackupEnv = resolveBackupEnv(),
): Promise<ArtifactResult> {
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

export async function dumpDatabaseDirect(
  outFile: string,
  env: BackupEnv = resolveBackupEnv(),
): Promise<ArtifactResult> {
  const connection = parsePgConnection(env.databaseUrl);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const tmpFile = `${outFile}.${process.pid}.tmp`;
  const child = spawn(
    env.pgDumpBin,
    pgArgs(connection, [
      '--format=custom',
      '--compress=9',
      '--no-owner',
      '--no-privileges',
      '--no-password',
    ]),
    { env: pgEnv(connection), stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 8192) stderr += chunk;
  });

  const finished = new Promise<void>((resolve, reject) => {
    child.on('error', (err) => {
      const missing =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `pg_dump executable not found (${env.pgDumpBin}); set PG_DUMP_BIN to a PostgreSQL client binary or install postgresql-client`
          : sanitizePgError(err.message, connection.password);
      reject(new Error(missing));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(sanitizePgError(stderr, connection.password)));
    });
  });

  try {
    await pipeline(child.stdout, createGzip(), createWriteStream(tmpFile));
    await finished;
    await fs.rename(tmpFile, outFile);
  } catch (err) {
    child.kill();
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
    throw err;
  }

  const stat = await fs.stat(outFile);
  return { filePath: outFile, sizeBytes: String(stat.size), checksum: await sha256File(outFile) };
}

export async function restoreDatabaseDump(
  artifactPath: string,
  targetUrl: string,
  expectedChecksum: string,
  env: BackupEnv = resolveBackupEnv(),
): Promise<void> {
  if (!(await verifyChecksum(artifactPath, expectedChecksum))) {
    throw new Error('Database restore artifact checksum mismatch');
  }
  if (!(await validateDatabaseDump(artifactPath))) {
    throw new Error('Database restore artifact failed validation');
  }
  const connection = parsePgConnection(targetUrl);
  const child = spawn(
    env.pgRestoreBin,
    pgArgs(connection, ['--exit-on-error', '--no-owner', '--no-privileges', '--no-password']),
    { env: pgEnv(connection), stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 8192) stderr += chunk;
  });
  const finished = new Promise<void>((resolve, reject) => {
    child.on('error', (err) => {
      const missing =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `pg_restore executable not found (${env.pgRestoreBin}); set PG_RESTORE_BIN to a PostgreSQL client binary or install postgresql-client`
          : sanitizePgError(err.message, connection.password);
      reject(new Error(missing));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(sanitizePgError(stderr, connection.password)));
    });
  });
  try {
    await pipeline(createReadStream(artifactPath), createGunzip(), child.stdin);
    await finished;
  } catch (err) {
    child.kill();
    throw err;
  }
}

export async function exportOrthancVolume(
  outFile: string,
  env: BackupEnv = resolveBackupEnv(),
): Promise<ArtifactResult> {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const { stdout } = await execFileAsync(
    env.podmanBin,
    ['volume', 'export', env.orthancVolume],
    { maxBuffer: 1024 * 1024 * 1024, encoding: 'buffer' },
  );
  await fs.writeFile(outFile, stdout);
  const stat = await fs.stat(outFile);
  const checksum = await sha256File(outFile);
  return { filePath: outFile, sizeBytes: String(stat.size), checksum };
}

async function gzipPrefix(filePath: string): Promise<Buffer> {
  const gunzip = createGunzip();
  return new Promise<Buffer>((resolve, reject) => {
    let prefix = Buffer.alloc(0);
    let settled = false;
    const finish = (value: Buffer) => {
      if (settled) return;
      settled = true;
      resolve(value);
      gunzip.destroy();
    };
    gunzip.on('data', (chunk: Buffer) => {
      prefix = Buffer.concat([prefix, chunk]).subarray(0, 64);
      if (prefix.length >= 64) finish(prefix);
    });
    gunzip.on('error', (err) => {
      if (prefix.length > 0) finish(prefix);
      else reject(err);
    });
    gunzip.on('end', () => finish(prefix));
    const source = createReadStream(filePath);
    source.on('error', (err: Error) => reject(err));
    source.pipe(gunzip);
  });
}

export async function validateDatabaseDump(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size < 16) return false;
    const handle = await fs.open(filePath, 'r');
    let raw: Buffer;
    try {
      raw = Buffer.alloc(64);
      await handle.read(raw, 0, 64, 0);
    } finally {
      await handle.close();
    }
    let text = raw.toString('utf8').toLowerCase();
    if (raw[0] === 0x1f && raw[1] === 0x8b) {
      text = (await gzipPrefix(filePath)).toString('utf8').toLowerCase();
      return text.includes('pgdmp');
    }
    return text.includes('postgresql database dump');
  } catch {
    return false;
  }
}

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
