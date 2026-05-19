import { sql } from 'drizzle-orm';
import { getDb, waves } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

export async function scheduleWaveProgression(): Promise<ScheduledEvent[]> {
  const db = getDb();

  const rows = (await db.execute(sql`
    SELECT w.id AS wave_id
    FROM ${waves} w
    WHERE w.state NOT IN ('draft', 'completed')
  `)) as unknown as { rows: Array<{ wave_id: string }> } | Array<{ wave_id: string }>;

  const list = Array.isArray(rows) ? rows : rows.rows;
  const bucket = sixHourBucket(new Date());

  return list.map((r) => ({
    agent: 'wave-launcher',
    payload: { mode: 'progress', waveId: r.wave_id },
    dedupeKey: `wave-launcher:wave:${r.wave_id}:${bucket}`,
  }));
}

function sixHourBucket(d: Date): string {
  const bucket = Math.floor(d.getUTCHours() / 6);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${date}-b${bucket}`;
}
