import { config } from 'dotenv';
config({ path: '.env.local' });
import {
  getDb,
  systemState,
  setOperatorConfig,
  type SetOperatorConfigArgs,
} from '@leadlandlord/db';

/**
 * Fleet config CLI — sets the human-only autonomy gates on system_state
 * idempotently (orchestrator plan §0.1, Phase 0).
 *
 *   pnpm tsx scripts/fleet-config.ts show
 *   pnpm tsx scripts/fleet-config.ts lock
 *   pnpm tsx scripts/fleet-config.ts set operatorMode=supervised autoApproveNiches=false
 *
 * `lock` sets the posture the orchestrator runs in:
 *   operatorEnabled=true, operatorMode=supervised, autoApproveNiches=false,
 *   autoApproveDomainBudgetUsd=0
 * which lets the operator monitor + auto-disable agents but never approve a
 * niche, create a site, or take a site live. Running `lock` twice yields the
 * same row.
 */

type Mode = 'manual' | 'supervised' | 'autonomous';
const MODES: Mode[] = ['manual', 'supervised', 'autonomous'];

function parseSetArgs(pairs: string[]): SetOperatorConfigArgs {
  if (pairs.length === 0) throw new Error('set requires at least one key=value pair');
  const out: SetOperatorConfigArgs = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new Error(`bad arg "${pair}" (expected key=value)`);
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    switch (key) {
      case 'operatorEnabled':
        out.operatorEnabled = value === 'true';
        break;
      case 'autoApproveNiches':
        out.autoApproveNiches = value === 'true';
        break;
      case 'operatorMode':
        if (!MODES.includes(value as Mode)) {
          throw new Error(`invalid operatorMode "${value}" (one of: ${MODES.join(', ')})`);
        }
        out.operatorMode = value as Mode;
        break;
      case 'autoApproveDomainBudgetUsd': {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error(`invalid number for ${key}: "${value}"`);
        out.autoApproveDomainBudgetUsd = n;
        break;
      }
      default:
        throw new Error(`unknown key "${key}"`);
    }
  }
  return out;
}

async function main() {
  const action = process.argv[2] ?? 'show';

  if (action === 'show') {
    const db = getDb();
    const rows = await db.select().from(systemState);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (action === 'lock') {
    const row = await setOperatorConfig({
      operatorEnabled: true,
      operatorMode: 'supervised',
      autoApproveNiches: false,
      autoApproveDomainBudgetUsd: 0,
    });
    console.log('Locked to supervised, no auto-approve (human-only site gates).');
    console.log(JSON.stringify(row, null, 2));
    return;
  }

  if (action === 'set') {
    const args = parseSetArgs(process.argv.slice(3));
    const row = await setOperatorConfig(args);
    console.log('Updated system_state:');
    console.log(JSON.stringify(row, null, 2));
    return;
  }

  console.error(`Unknown action "${action}". Use: show | lock | set key=value ...`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
