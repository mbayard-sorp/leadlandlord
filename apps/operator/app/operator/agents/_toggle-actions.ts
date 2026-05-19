'use server';

import { revalidatePath } from 'next/cache';
import { getDb, agentBudgets, eq, inArray } from '@leadlandlord/db';
import { agentRegistry } from '@leadlandlord/agents';
import { log } from '@leadlandlord/shared/log';

interface ActionResult {
  ok: boolean;
  message?: string;
}

function knownAgent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(agentRegistry, name);
}

async function upsertEnabled(name: string, enabled: boolean): Promise<void> {
  const db = getDb();
  await db
    .insert(agentBudgets)
    .values({ agent: name, enabled })
    .onConflictDoUpdate({
      target: agentBudgets.agent,
      set: { enabled, updatedAt: new Date() },
    });
}

export async function setAgentEnabled(name: string, enabled: boolean): Promise<ActionResult> {
  if (!knownAgent(name)) return { ok: false, message: `Unknown agent: ${name}` };
  await upsertEnabled(name, enabled);
  log.warn({ agent: name, enabled }, 'agent enable flag flipped from operator UI');
  revalidatePath('/operator/agents');
  return { ok: true, message: `${name} ${enabled ? 'enabled' : 'disabled'}.` };
}

export async function setAllAgentsEnabled(enabled: boolean): Promise<ActionResult> {
  const db = getDb();
  const names = Object.keys(agentRegistry);
  await db.transaction(async (tx) => {
    for (const name of names) {
      await tx
        .insert(agentBudgets)
        .values({ agent: name, enabled })
        .onConflictDoUpdate({
          target: agentBudgets.agent,
          set: { enabled, updatedAt: new Date() },
        });
    }
  });
  log.warn({ enabled, count: names.length }, 'bulk agent enable flip from operator UI');
  revalidatePath('/operator/agents');
  return { ok: true, message: `${enabled ? 'Enabled' : 'Disabled'} ${names.length} agents.` };
}

export async function loadAgentEnabledMap(): Promise<Record<string, boolean>> {
  const db = getDb();
  const names = Object.keys(agentRegistry);
  if (names.length === 0) return {};
  const rows = await db
    .select({ agent: agentBudgets.agent, enabled: agentBudgets.enabled })
    .from(agentBudgets)
    .where(inArray(agentBudgets.agent, names));
  const map: Record<string, boolean> = {};
  for (const name of names) map[name] = true; // default: enabled when no row
  for (const r of rows) map[r.agent] = r.enabled;
  return map;
}
