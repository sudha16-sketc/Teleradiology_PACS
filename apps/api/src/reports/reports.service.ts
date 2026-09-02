import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { createHash } from 'crypto';
import type { Response } from 'express';

function contentHash(findings: string, impression: string, recommendations = ''): string {
  return createHash('sha256')
    .update(findings + impression + recommendations)
    .digest('hex')
    .slice(0, 16);
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: { id: string; role: string; hospitalId?: string }) {
    const where: Record<string, unknown> = {};
    if (user.role === 'HOSPITAL_USER' && user.hospitalId) {
      where.study = { hospitalId: user.hospitalId, status: { in: ['FINAL', 'DELIVERED'] } };
    }

    const reports = await this.prisma.report.findMany({
      where,
      include: {
        study: {
          include: { patient: true, hospital: true },
        },
        author: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { data: reports };
  }

  async hospitalReports(user: { id: string; role: string; hospitalId?: string }) {
    if (user.role === 'HOSPITAL_USER' && !user.hospitalId) {
      throw new ForbiddenException('Your account is not linked to a hospital');
    }

    const where: Record<string, unknown> = {
      status: { in: ['FINAL', 'AMENDED'] },
      study: { hospitalId: user.hospitalId!, status: { in: ['FINAL', 'DELIVERED', 'AMENDED'] } },
    };

    const reports = await this.prisma.report.findMany({
      where,
      include: {
        study: {
          include: { patient: true, hospital: true },
        },
        author: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { data: reports };
  }

  async getByStudy(studyUid: string, user?: { role: string; hospitalId?: string }) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    if (user?.role === 'HOSPITAL_USER' && study.hospitalId !== user.hospitalId) {
      throw new ForbiddenException('You do not have access to studies from this hospital');
    }

    const report = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      include: { author: true, versions: true },
      orderBy: { version: 'desc' },
    });

    return { data: report };
  }

  async createOrUpdate(
    studyUid: string,
    dto: { authorId: string; findings?: string; impression?: string; recommendations?: string; criticalFinding?: boolean },
  ) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    const findings = dto.findings || '';
    const impression = dto.impression || '';
    const recommendations = dto.recommendations || '';
    const hash = contentHash(findings, impression, recommendations);

    const existing = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      orderBy: { version: 'desc' },
    });

    if (existing && existing.status === 'DRAFT') {
      const updated = await this.prisma.report.update({
        where: { id: existing.id },
        data: {
          findings,
          impression,
          recommendations,
          criticalFinding: dto.criticalFinding ?? false,
          contentHash: hash,
        },
        include: { author: true },
      });
      return { data: updated };
    }

    const created = await this.prisma.report.create({
      data: {
        studyId: study.id,
        authorId: dto.authorId,
        status: 'DRAFT',
        findings,
        impression,
        recommendations,
        criticalFinding: dto.criticalFinding ?? false,
        contentHash: hash,
      },
      include: { author: true },
    });

    return { data: created };
  }

  async saveDraft(
    studyUid: string,
    dto: { authorId: string; findings?: string; impression?: string; recommendations?: string; criticalFinding?: boolean },
  ) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    const findings = dto.findings || '';
    const impression = dto.impression || '';
    const recommendations = dto.recommendations || '';
    const hash = contentHash(findings, impression, recommendations);

    const existing = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      orderBy: { version: 'desc' },
    });

    let report;
    if (existing && existing.status === 'DRAFT') {
      report = await this.prisma.report.update({
        where: { id: existing.id },
        data: {
          findings,
          impression,
          recommendations,
          criticalFinding: dto.criticalFinding ?? false,
          contentHash: hash,
        },
        include: { author: true },
      });
    } else {
      report = await this.prisma.report.create({
        data: {
          studyId: study.id,
          authorId: dto.authorId,
          status: 'DRAFT',
          findings,
          impression,
          recommendations,
          criticalFinding: dto.criticalFinding ?? false,
          contentHash: hash,
        },
        include: { author: true },
      });
    }

    await this.prisma.study.update({
      where: { studyInstanceUid: studyUid },
      data: { status: 'DRAFT_REPORT', reportingStartedAt: study.reportingStartedAt ?? new Date() },
    });

    return { data: report };
  }

  async signOff(studyUid: string, signedOffBy: string) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    const report = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      orderBy: { version: 'desc' },
    });
    if (!report) throw new NotFoundException(`No report found for study ${studyUid}`);
    if (!report.findings && !report.impression) {
      throw new NotFoundException('Report is empty; add findings and impression before signing off');
    }

    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: 'FINAL',
        signedOffBy,
        signedOffAt: new Date(),
      },
    });

    await this.prisma.reportVersion.create({
      data: {
        reportId: report.id,
        version: report.version,
        status: 'FINAL',
        findings: report.findings,
        impression: report.impression,
        recommendations: report.recommendations,
        authorId: report.authorId,
        contentHash: report.contentHash,
      },
    });

    await this.prisma.study.update({
      where: { studyInstanceUid: studyUid },
      data: { status: 'FINAL', finalizedAt: new Date() },
    });

    return { data: updated };
  }

  async amend(
    studyUid: string,
    dto: { authorId: string; findings: string; impression: string; recommendations?: string },
  ) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    const previous = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      orderBy: { version: 'desc' },
    });

    const newVersion = previous ? previous.version + 1 : 1;
    const hash = contentHash(dto.findings, dto.impression, dto.recommendations);

    const created = await this.prisma.report.create({
      data: {
        studyId: study.id,
        authorId: dto.authorId,
        status: 'AMENDED',
        version: newVersion,
        findings: dto.findings,
        impression: dto.impression,
        recommendations: dto.recommendations || '',
        contentHash: hash,
      },
      include: { author: true },
    });

    if (previous && previous.status === 'FINAL') {
      await this.prisma.reportVersion.create({
        data: {
          reportId: previous.id,
          version: previous.version,
          status: previous.status,
          findings: previous.findings,
          impression: previous.impression,
          recommendations: previous.recommendations,
          authorId: previous.authorId,
          contentHash: previous.contentHash,
        },
      });
    }

    await this.prisma.study.update({
      where: { studyInstanceUid: studyUid },
      data: { status: 'AMENDED' },
    });

    return { data: created };
  }

  async validate(
    studyUid: string,
    dto: { status: 'FINAL' | 'PENDING_SIGNOFF'; reason?: string },
  ) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    const report = await this.prisma.report.findFirst({
      where: { studyId: study.id },
      orderBy: { version: 'desc' },
    });
    if (!report) throw new NotFoundException(`No report found for study ${studyUid}`);

    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: { status: dto.status },
      include: { author: true },
    });

    return { data: updated, ...(dto.reason ? { reason: dto.reason } : {}) };
  }

  async hospitalPdf(
    studyUid: string,
    user: { role: string; hospitalId?: string },
    res: Response,
  ) {
    const study = await this.prisma.study.findUnique({
      where: { studyInstanceUid: studyUid },
      include: { patient: true, hospital: true },
    });
    if (!study) throw new NotFoundException(`Study ${studyUid} not found`);

    if (user.role === 'HOSPITAL_USER' && study.hospitalId !== user.hospitalId) {
      throw new ForbiddenException('You do not have access to studies from this hospital');
    }

    if (!['FINAL', 'DELIVERED', 'AMENDED'].includes(study.status)) {
      throw new NotFoundException('Final report is not yet available for this study');
    }

    const report = await this.prisma.report.findFirst({
      where: { studyId: study.id, status: { in: ['FINAL', 'AMENDED'] } },
      orderBy: { version: 'desc' },
      include: { author: true },
    });
    if (!report) throw new NotFoundException(`No final report found for study ${studyUid}`);

    const pdf = this.buildPdf({
      study,
      report,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="report-${study.accessionNumber}.pdf"`,
    );
    res.setHeader('Content-Length', Buffer.byteLength(pdf));
    res.send(Buffer.from(pdf, 'binary'));
  }

  private escapePdfText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private buildPdf(opts: {
    study: any;
    report: any;
  }): string {
    const { study, report } = opts;

    const lines: string[] = [];
    const push = (text: string) => lines.push(text);
    const pushKey = (key: string, value: string) => push(`${key}: ${value}`);

    push('AXIS RADIOLOGY PACS - FINAL RADIOLOGY REPORT');
    push('---------------------------------------------');
    push('');
    pushKey('Accession #', study.accessionNumber);
    pushKey('Study UID', study.studyInstanceUid);
    pushKey('Study Date', study.studyDate ? new Date(study.studyDate).toISOString().slice(0, 10) : '');
    pushKey('Modality', study.modality);
    pushKey('Body Part', study.bodyPart);
    pushKey('Study Description', study.studyDescription);
    pushKey('Referring Physician', study.referringPhysician);
    pushKey('Hospital', study.hospital?.name ?? '');
    push('');
    push('PATIENT');
    push('-------');
    pushKey('Name', study.patient?.displayName ?? '');
    pushKey('Patient ID', study.patient?.patientId ?? '');
    pushKey('DOB', study.patient?.dateOfBirth ? new Date(study.patient.dateOfBirth).toISOString().slice(0, 10) : '');
    pushKey('Gender', study.patient?.gender ?? '');
    push('');
    push('CLINICAL HISTORY');
    push('----------------');
    push(study.clinicalHistory || 'N/A');
    push('');
    push('FINDINGS');
    push('--------');
    push(report.findings || 'N/A');
    push('');
    push('IMPRESSION');
    push('----------');
    push(report.impression || 'N/A');
    if (report.recommendations) {
      push('');
      push('RECOMMENDATIONS');
      push('---------------');
      push(report.recommendations);
    }
    if (report.criticalFinding) {
      push('');
      push('*** CRITICAL FINDING - ACTION REQUIRED ***');
    }
    push('');
    push('------------------------------------------------');
    pushKey('Report Status', report.status);
    pushKey('SIGNED OFF BY', report.signedOffBy ?? '');
    if (report.signedOffAt) pushKey('Signed Off At', new Date(report.signedOffAt).toISOString());
    pushKey('Report Version', String(report.version));
    pushKey('Report ID', report.id);

    const contentLines = lines.map((l) => this.escapePdfText(l));

    let pdf = '%PDF-1.4\n';
    const objects: string[] = [];

    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');

    let contentStream = 'BT /F1 11 Tf 50 790 Td 16 TL\n';
    for (const l of contentLines) {
      contentStream += `(${l}) Tj T*\n`;
    }
    contentStream += 'ET';

    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
    objects.push(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    const offsets: number[] = [0];
    let byteLength = Buffer.byteLength(pdf, 'binary');

    for (let i = 0; i < objects.length; i++) {
      offsets.push(byteLength);
      const obj = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
      pdf += obj;
      byteLength += Buffer.byteLength(obj, 'binary');
    }

    const xrefStart = byteLength;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return pdf;
  }
}
