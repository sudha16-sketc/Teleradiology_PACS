import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Check ReportTemplate table columns
  const columns = await prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'ReportTemplate'
    ORDER BY ordinal_position;
  `;
  console.log('=== ReportTemplate Columns ===');
  console.table(columns);

  // 2. Check indexes
  const indexes = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'ReportTemplate';
  `;
  console.log('\n=== ReportTemplate Indexes ===');
  console.table(indexes);

  // 3. Check foreign key
  const fk = await prisma.$queryRaw`
    SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'ReportTemplate';
  `;
  console.log('\n=== ReportTemplate Foreign Keys ===');
  console.table(fk);

  // 4. Check migration record
  const migration = await prisma.$queryRaw`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    WHERE migration_name = '20260927213844_add_report_templates';
  `;
  console.log('\n=== Migration Record ===');
  console.table(migration);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});