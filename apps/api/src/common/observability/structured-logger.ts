/**
 * Minimal structured logger. Emits single-line JSON records to stdout/stderr so
 * they can be collected by a log shipper. Never includes secrets, cookies,
 * Authorization headers, JWT payloads, full DICOM bytes, or report text unless a
 * caller explicitly passes already-sanitized fields.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) record[k] = v;
  }
  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log('error', msg, fields),
};
