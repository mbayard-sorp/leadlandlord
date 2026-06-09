import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { systemState, type SystemState } from './schema';

/**
 * Portfolio-wide kill switch + other global state.
 *
 * Single-row pattern: id='global'. Helpers transparently insert the row on
 * first read so callers never have to handle "no row yet". The operator
 * dashboard activates the switch via setKillSwitch; BaseAgent.run checks it
 * before any agent does work.
 */

const GLOBAL_ID = 'global';

async function ensureRow(): Promise<SystemState> {
  const db = getDb();
  const rows = await db.select().from(systemState).where(eq(systemState.id, GLOBAL_ID)).limit(1);
  if (rows[0]) return rows[0];
  const [inserted] = await db
    .insert(systemState)
    .values({ id: GLOBAL_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  // Race: another process inserted between our select and insert. Re-read.
  const reread = await db
    .select()
    .from(systemState)
    .where(eq(systemState.id, GLOBAL_ID))
    .limit(1);
  if (!reread[0]) throw new Error('failed to ensure system_state row');
  return reread[0];
}

export async function getSystemState(): Promise<SystemState> {
  return ensureRow();
}

export async function isKillSwitchActive(): Promise<boolean> {
  const row = await ensureRow();
  return row.killSwitch;
}

export interface SetKillSwitchArgs {
  active: boolean;
  reason?: string | null;
  activatedBy?: string | null;
}

export async function setKillSwitch(args: SetKillSwitchArgs): Promise<SystemState> {
  await ensureRow();
  const db = getDb();
  const [row] = await db
    .update(systemState)
    .set({
      killSwitch: args.active,
      killSwitchReason: args.active ? args.reason ?? null : null,
      killSwitchActivatedAt: args.active ? new Date() : null,
      killSwitchActivatedBy: args.active ? args.activatedBy ?? null : null,
      updatedAt: new Date(),
    })
    .where(eq(systemState.id, GLOBAL_ID))
    .returning();
  if (!row) throw new Error('system_state row missing after ensureRow');
  return row;
}

export interface SetOperatorConfigArgs {
  operatorEnabled?: boolean;
  operatorMode?: 'manual' | 'supervised' | 'autonomous';
  autoApproveNiches?: boolean;
  autoApproveDomainBudgetUsd?: number | string;
}

/**
 * Idempotently set the autonomy-gate fields on system_state. Only the fields
 * provided are written; omitted fields are left untouched. This is the single
 * supported writer for the human-only gates that keep the agent fleet from
 * approving niches / creating sites on its own (orchestrator plan §0.1):
 * leaving operatorMode at 'supervised' + autoApproveNiches=false means no
 * agent can auto-approve a niche, regardless of operatorEnabled.
 */
export async function setOperatorConfig(args: SetOperatorConfigArgs): Promise<SystemState> {
  await ensureRow();
  const db = getDb();
  const patch: Partial<typeof systemState.$inferInsert> = { updatedAt: new Date() };
  if (args.operatorEnabled !== undefined) patch.operatorEnabled = args.operatorEnabled;
  if (args.operatorMode !== undefined) patch.operatorMode = args.operatorMode;
  if (args.autoApproveNiches !== undefined) patch.autoApproveNiches = args.autoApproveNiches;
  if (args.autoApproveDomainBudgetUsd !== undefined) {
    patch.autoApproveDomainBudgetUsd = String(args.autoApproveDomainBudgetUsd);
  }
  const [row] = await db
    .update(systemState)
    .set(patch)
    .where(eq(systemState.id, GLOBAL_ID))
    .returning();
  if (!row) throw new Error('system_state row missing after ensureRow');
  return row;
}

/**
 * Set the portfolio-wide daily spend ceiling (orchestrator Phase 2/4). A value
 * of 0 disables the global cap. Enforced in BaseAgent.assertBudgetAvailable.
 */
export async function setGlobalDailyCostCap(usd: number): Promise<SystemState> {
  await ensureRow();
  const db = getDb();
  const [row] = await db
    .update(systemState)
    .set({ globalDailyCostCapUsd: usd.toFixed(2), updatedAt: new Date() })
    .where(eq(systemState.id, GLOBAL_ID))
    .returning();
  if (!row) throw new Error('system_state row missing after ensureRow');
  return row;
}
