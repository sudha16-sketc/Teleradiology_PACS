import 'reflect-metadata';
import request from 'supertest';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import type { INestApplication } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { readFileSync } from 'fs';

let app: INestApplication;
let server: any;

const h_cgh = USERS.H_CGH;
const h_mmc = USERS.H_MMC;

const REAL_DICOM = '/tmp/opencode/emri_small.dcm';
const CGH_HOSPITAL_ID = 'hosp-001';

// ---------------------------------------------------------------------------
// ZIP / DICOM fixture builders
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * Builds a raw (method 0 / stored) ZIP so we can control entry names and
 * declared sizes precisely -- AdmZip's own builder sanitises entry names,
 * which would defeat the Zip-Slip and per-file-size guard tests.
 */
function rawZip(
  entries: Array<{ name: string; data: Buffer; declaredSize?: number }>,
): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const declared = e.declaredSize ?? data.length;
    const crc = crc32(data);
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20), u16(0), u16(0), u16(0x21),
      u32(crc), u32(declared), u32(declared),
      u16(name.length), u16(0),
      name, data,
    ]);
    parts.push(local);
    central.push(
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x01, 0x02]),
        u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21),
        u32(crc), u32(declared), u32(declared),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0), u16(entries.length % 0x10000), u16(entries.length % 0x10000),
    u32(cd.length), u32(cdStart), u16(0),
  ]);
  return Buffer.concat([...parts, cd, eocd]);
}

/** Explicit-VR little-endian DICOM element. */
function el(group: number, elem: number, vr: string, value: string): Buffer {
  const v = Buffer.from(value.length % 2 ? value + '\u0000' : value, 'latin1');
  const head = Buffer.from([group & 255, (group >> 8) & 255, elem & 255, (elem >> 8) & 255]);
  const vrB = Buffer.from(vr, 'ascii');
  let tail: Buffer;
  if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(v.length, 0);
    tail = Buffer.concat([vrB, Buffer.alloc(2), len]);
  } else {
    const len = Buffer.alloc(2);
    len.writeUInt16LE(v.length, 0);
    tail = Buffer.concat([vrB, len]);
  }
  return Buffer.concat([head, tail, v]);
}

/** Minimal Part-10 DICOM with configurable presence + values of required UIDs. */
function buildP10(opts: {
  study?: boolean;
  series?: boolean;
  sop?: boolean;
  sopClass?: boolean;
  studyUid?: string;
  sopUid?: string;
} = {}): Buffer {
  const all = { study: true, series: true, sop: true, sopClass: true, ...opts };
  const studyUid = opts.studyUid ?? '1.2.826.0.1.3680043.2.1143.5';
  const sopUid = opts.sopUid ?? '1.2.826.0.1.3680043.2.1143.9';
  const parts: Buffer[] = [Buffer.alloc(128), Buffer.from('DICM')];
  const meta: Array<[number, number, string, string]> = [
    [0x0002, 0x0001, 'OB', '\x00\x01'],
    [0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'],
    [0x0002, 0x0003, 'UI', sopUid],
    [0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'],
  ];
  for (const m of meta) {
    parts.push(el(m[0], m[1], m[2], m[3]));
  }
  if (all.sopClass) parts.push(el(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'));
  if (all.sop) parts.push(el(0x0008, 0x0018, 'UI', sopUid));
  parts.push(el(0x0008, 0x0060, 'CS', 'MR'));
  if (all.study) parts.push(el(0x0020, 0x000d, 'UI', studyUid));
  if (all.series) parts.push(el(0x0020, 0x000e, 'UI', '1.2.826.0.1.3680043.2.1143.6'));
  return Buffer.concat(parts);
}

function zipAround(file: Buffer, name = 'study.dcm'): Buffer {
  const z = new AdmZip();
  z.addFile(name, file);
  return z.toBuffer();
}

let createdStudyIds: string[] = [];

async function ingest(agent: any, buf: Buffer, filename: string): Promise<request.Response> {
  return agent
    .post('/api/dicom/ingest')
    .attach('file', buf, { filename, contentType: 'application/octet-stream' });
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
});

afterAll(async () => {
  for (const studyId of createdStudyIds) {
    await prisma.instance.deleteMany({ where: { studyId } }).catch(() => undefined);
    await prisma.series.deleteMany({ where: { studyId } }).catch(() => undefined);
    await prisma.worklistItem.deleteMany({ where: { studyId } }).catch(() => undefined);
    const patient = await prisma.study
      .findUnique({ where: { id: studyId }, select: { patientId: true } })
      .catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { resourceId: studyId } }).catch(() => undefined);
    await prisma.study.delete({ where: { id: studyId } }).catch(() => undefined);
    if (patient?.patientId) {
      const remaining = await prisma.study.count({
        where: { patientId: patient.patientId },
      });
      if (remaining === 0) {
        await prisma.patient.delete({ where: { id: patient.patientId } }).catch(() => undefined);
      }
    }
  }
  await prisma.$disconnect();
  await app.close();
});

describe('Phase 2 -- ZIP hardening & DICOM validation (no Orthanc, no DB writes)', () => {
  let cghAgent: any;

  beforeAll(async () => {
    cghAgent = await loginAgent(server, h_cgh);
  });

  it('DICOM-ZIP-1: rejects a corrupt ZIP archive', async () => {
    const corrupt = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('garbage-data-here')]);
    const res = await ingest(cghAgent, corrupt, 'corrupt.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ZIP');
  });

  it('DICOM-ZIP-2: rejects a Zip Slip archive (../ in entry path)', async () => {
    const slip = rawZip([{ name: '../evil.dcm', data: buildP10() }]);
    const res = await ingest(cghAgent, slip, 'slip.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Zip Slip');
  });

  it('DICOM-ZIP-3: rejects a nested ZIP archive', async () => {
    const inner = new AdmZip();
    inner.addFile('a.dcm', buildP10());
    const outer = new AdmZip();
    outer.addFile('inner.zip', inner.toBuffer());
    const res = await ingest(cghAgent, outer.toBuffer(), 'nested.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Nested');
  });

  it('DICOM-ZIP-4: rejects an archive containing an executable (ELF)', async () => {
    const exe = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('boot')]);
    const res = await ingest(cghAgent, zipAround(exe, 'tool.bin'), 'exe.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('executable');
  });

  it('DICOM-ZIP-5: rejects an archive with too many entries', async () => {
    // AdmZip deflates entries, keeping the 4001-entry archive under the 1MiB
    // upload limit so the entry-count guard (MAX_ENTRY_COUNT=4000) is hit.
    const z = new AdmZip();
    for (let i = 0; i < 4001; i++) z.addFile(`f${i}.dcm`, buildP10());
    const res = await ingest(cghAgent, z.toBuffer(), 'many.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('too many entries');
  });

  it('DICOM-ZIP-6: rejects an entry that exceeds the per-file size limit', async () => {
    // Declared uncompressed size > 1MiB test limit (the guard checks the
    // declared size before decompressing, so no huge buffer is allocated).
    const res = await ingest(cghAgent, rawZip([{ name: 'big.dcm', data: buildP10(), declaredSize: 2 * 1024 * 1024 }]), 'big.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('per-file size limit');
  });

  it('DICOM-ZIP-7: rejects an archive whose total extracted size exceeds the limit', async () => {
    // Two 700KiB entries deflate to a small archive (under the 1MiB upload
    // limit) but decompress to 1.4MiB > 1MiB MAX_EXTRACTED_BYTES.
    const junk = Buffer.alloc(700 * 1024, 0);
    const z = new AdmZip();
    z.addFile('a.bin', junk);
    z.addFile('b.bin', junk);
    const res = await ingest(cghAgent, z.toBuffer(), 'too-much.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('exceeds the maximum allowed size');
  });

  it('DICOM-VAL-1: rejects a file that is not DICOM', async () => {
    const text = Buffer.from('this is definitely not a dicom file at all');
    const res = await ingest(cghAgent, text, 'notdicom.txt');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('DICOM');
  });

  it('DICOM-VAL-2: rejects a DICOM instance missing StudyInstanceUID', async () => {
    const res = await ingest(cghAgent, zipAround(buildP10({ study: false }), 'm.dcm'), 'm1.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Study Instance UID');
  });

  it('DICOM-VAL-3: rejects a DICOM instance missing SeriesInstanceUID', async () => {
    const res = await ingest(cghAgent, zipAround(buildP10({ series: false }), 'm.dcm'), 'm2.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Series Instance UID');
  });

  it('DICOM-VAL-4: rejects a DICOM instance missing SOPInstanceUID', async () => {
    const res = await ingest(cghAgent, zipAround(buildP10({ sop: false }), 'm.dcm'), 'm3.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('SOP Instance UID');
  });

  it('DICOM-VAL-5: rejects an archive containing instances from multiple studies', async () => {
    const a = buildP10();
    const b = buildP10({ studyUid: '1.2.826.0.1.3680043.2.1143.77' });
    const z = new AdmZip();
    z.addFile('a.dcm', a);
    z.addFile('b2.dcm', b);
    const res = await ingest(cghAgent, z.toBuffer(), 'multi.zip');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('multiple studies');
  });
});

describe('Phase 2 -- real ingest: Orthanc, hierarchy persistence, ownership, audit', () => {
  let cghAgent: any;
  let mmcAgent: any;

  beforeAll(async () => {
    cghAgent = await loginAgent(server, h_cgh);
    mmcAgent = await loginAgent(server, h_mmc);
  });

  it('DICOM-ING-1: uploads a real DICOM, persists hierarchy, keys ownership from auth, audits events', async () => {
    const real = readFileSync(REAL_DICOM);
    const studyUid = '1.2.826.0.1.3680043.2.1143.3365540476747857567072393009509418480';
    const seriesUid = '1.2.826.0.1.3680043.2.1143.3712364435022872412969836992152438492';
    const sopUid = '1.2.826.0.1.3680043.2.1143.6455556726214900995651753669640998622';

    const res = await ingest(cghAgent, zipAround(real, 'emri_small.dcm'), 'emri.zip');
    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data.orthancStudyId).toBeTruthy();
    expect(data.orthancPatientId).toBeTruthy();
    expect(data.instanceCount).toBe(1);
    expect(data.skipped).toBe(0);

    const studyId: string = data.study.id;
    createdStudyIds.push(studyId);

    // Hierarchy persisted with real hospital ownership from the auth token.
    const study = await prisma.study.findUniqueOrThrow({
      where: { id: studyId },
      include: { patient: true },
    });
    expect(study.studyInstanceUid).toBe(studyUid);
    expect(study.hospitalId).toBe(CGH_HOSPITAL_ID);
    expect(study.status).toBe('UNASSIGNED');
    expect(study.orthancStudyId).toBe(data.orthancStudyId);
    expect(study.orthancPatientId).toBe(data.orthancPatientId);
    expect(study.seriesCount).toBe(1);
    expect(study.instanceCount).toBe(1);
    expect(study.patient.hospitalId).toBe(CGH_HOSPITAL_ID);

    const series = await prisma.series.findUniqueOrThrow({
      where: { seriesInstanceUid: seriesUid },
    });
    expect(series.studyId).toBe(studyId);
    expect(series.orthancSeriesId).toBeTruthy();
    expect(series.modality).toBe('MRI');

    const instance = await prisma.instance.findUniqueOrThrow({
      where: { sopInstanceUid: sopUid },
    });
    expect(instance.studyId).toBe(studyId);
    expect(instance.seriesId).toBe(series.id);
    expect(instance.orthancInstanceId).toBeTruthy();

    const wl = await prisma.worklistItem.findUnique({ where: { studyId } });
    expect(wl).toBeTruthy();

    // Both audit events were emitted.
    const audits = await prisma.auditLog.findMany({
      where: { resourceId: studyId },
      select: { action: true },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('STUDY_UPLOADED');
    expect(actions).toContain('DICOM_IMPORTED');
  });

  it('DICOM-ING-2: hospital ownership is enforced by auth -- another hospital cannot access it', async () => {
    const uid = '1.2.826.0.1.3680043.2.1143.3365540476747857567072393009509418480';
    const res = await mmcAgent.get(`/api/studies/${uid}`).expect(403);
    expect(res.body.message).toContain('access');
  });
});
