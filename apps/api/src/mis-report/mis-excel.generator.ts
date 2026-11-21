import { PassThrough } from 'stream';
import ExcelJS from 'exceljs';

export const MIS_REPORT_HEADERS = [
  'Center / Site',
  'Patient-Id',
  'Patient-Name',
  'Patient Age',
  'Gender',
  'Modality',
  'StudyName/  Study Discrption',
  'ImageCount',
  'Referring Physician Name',
  'Status',
  'Priority',
  'noOfReports',
  'studyDateTime',
  'uploadCompletedAt',
  'historyCreatedAt',
  'assignedAt',
  'signedOffAt',
  'Verified At',
  'Study Assigned By',
  'Study Assigned To',
  'Study Reported By',
  'Study Verified By',
  'TurnAroundTime',
  'TatAssignedToSSignedOff',
] as const;

export type MisExcelRow = Array<Date | string | number | null>;

const SHEET_NAME = 'MIS Report';
const DATE_NUMFMT = 'yyyy-mm-dd hh:mm:ss';
const DURATION_NUMFMT = '[h]:mm:ss';

const COLUMN_WIDTHS = [
  22, 18, 24, 12, 10, 12, 38, 12, 28, 22, 12, 13, 20, 20, 20, 20, 20, 20,
  22, 22, 22, 22, 18, 24,
];

const TEXT_COLUMNS = new Set([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 19, 20, 21, 22]);
const DATE_COLUMNS = new Set([13, 14, 15, 16, 17, 18]);
const TAT_COLUMNS = new Set([23, 24]);

function safeText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function addStyledRow(
  sheet: ExcelJS.Worksheet,
  values: Array<Date | string | number | null>,
): void {
  const normalized = values.map((value) => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return value;
    return safeText(value);
  });
  const row = sheet.addRow(normalized);
  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.alignment = { vertical: 'top', wrapText: false };
    if (DATE_COLUMNS.has(columnNumber)) cell.numFmt = DATE_NUMFMT;
    if (TAT_COLUMNS.has(columnNumber)) cell.numFmt = DURATION_NUMFMT;
    if (TEXT_COLUMNS.has(columnNumber)) cell.numFmt = '@';
  });
  row.commit();
}

export async function buildMisWorkbook(
  rows: AsyncIterable<MisExcelRow> | Iterable<MisExcelRow>,
  generatedAt: Date,
): Promise<{ buffer: Buffer; rowCount: number }> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    output.on('end', resolve);
    output.on('finish', resolve);
    output.on('error', reject);
  });

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = 'Axis PACS';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }],
  });
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const header = sheet.addRow([...MIS_REPORT_HEADERS]);
  header.height = 34;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E79' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB7C9D6' } },
      left: { style: 'thin', color: { argb: 'FFB7C9D6' } },
      bottom: { style: 'thin', color: { argb: 'FFB7C9D6' } },
      right: { style: 'thin', color: { argb: 'FFB7C9D6' } },
    };
  });
  header.commit();

  let writtenRows = 0;
  for await (const row of rows) {
    addStyledRow(sheet, row);
    writtenRows += 1;
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, writtenRows + 1), column: MIS_REPORT_HEADERS.length },
  };
  await sheet.commit();
  await workbook.commit();
  output.end();
  await finished;

  return { buffer: Buffer.concat(chunks), rowCount: writtenRows };
}
