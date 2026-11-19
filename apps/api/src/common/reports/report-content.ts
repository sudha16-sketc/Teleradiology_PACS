import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { htmlToPlainText } from '../html.js';

export interface ReportContent {
  clinicalHistory?: string;
  findings?: string;
  impression?: string;
  technique?: string;
  comparison?: string;
  recommendations?: string;
  contentHtml?: string | null;
  criticalFinding?: boolean;
}

export function contentHash(c: ReportContent = {}): string {
  const parts: string[] = [
    c.clinicalHistory ?? '',
    c.findings ?? '',
    c.impression ?? '',
    c.technique ?? '',
    c.comparison ?? '',
    c.recommendations ?? '',
    c.criticalFinding ? 'critical' : 'normal',
  ];
  if (c.contentHtml) parts.push(c.contentHtml);
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function hasRequiredReportContent(report: ReportContent): boolean {
  if (htmlToPlainText(report.contentHtml).length > 0) return true;
  return Boolean(report.findings?.trim() && report.impression?.trim());
}

export interface WorkflowReport extends ReportContent {
  status: string;
  signedOffBy: string | null;
  signedOffAt: Date | null;
  contentHash: string;
}

export function assertSignedReportReady(
  report: WorkflowReport | null,
): asserts report is WorkflowReport {
  if (!report) {
    throw new ConflictException('No signed report exists for this study.');
  }
  if (report.status !== 'SIGNED') {
    throw new ConflictException(
      `The report must be signed before it can enter review (currently ${report.status}).`,
    );
  }
  if (!report.signedOffBy || !report.signedOffAt) {
    throw new ConflictException('The report is missing a valid radiologist signature.');
  }
  if (!hasRequiredReportContent(report)) {
    throw new ConflictException('The signed report has no clinical content.');
  }
  if (!report.contentHash) {
    throw new ConflictException('The signed report has no content integrity hash.');
  }
}
