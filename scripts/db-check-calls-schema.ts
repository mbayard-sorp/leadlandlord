import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const cols = (await sql`SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = 'calls' ORDER BY ordinal_position`) as Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>;
  console.log(`calls columns (${cols.length}):`);
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(28)} ${c.data_type.padEnd(30)} null=${c.is_nullable}${c.column_default ? ' default=' + c.column_default : ''}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
