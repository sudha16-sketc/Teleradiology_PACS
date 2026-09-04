process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://axis:axis_dev@localhost:5432/axis_pacs_test';
process.env.NODE_ENV = 'test';

// Deterministic, small DICOM limits for e2e so the size guards can be
// exercised without allocating 200MB fixtures. 1MiB is still large enough for
// the real de-identified volume used in the happy-path ingest test.
process.env.AXIS_DICOM_MAX_UPLOAD_BYTES = '1048576';
process.env.AXIS_DICOM_MAX_FILE_BYTES = '1048576';
process.env.AXIS_DICOM_MAX_EXTRACTED_BYTES = '1048576';

process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('UNCAUGHT:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (err) => {
  // eslint-disable-next-line no-console
  console.error('UNHANDLED_REJECTION:', err && (err as any).stack ? (err as any).stack : err);
});
