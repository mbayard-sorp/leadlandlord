import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Phase 0 invariant (orchestrator plan §0.1): NO agent in packages/agents/src
 * may import or call the human-only site-lifecycle actions. Approving a niche,
 * creating a site, and taking a site live are reserved for the human operator
 * and live exclusively in apps/operator. This grep over the agent source tree
 * is the belt-and-suspenders complement to the config-layer gate (supervised
 * mode + autoApproveNiches=false).
 *
 * Note: the operator agent has its OWN inlined niche-approval path, but that
 * path is gated by `shouldAutoApproveNiche` (autonomous-only) and is covered
 * by the operator decision-tree tests — it does not import these symbols.
 */

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Symbols that only exist on the human-operator side (apps/operator). An agent
// source referencing one of these would mean the gate has been breached.
const FORBIDDEN = ['promoteSiteToLive', 'approveNiche', 'go-live-actions'];

function collectAgentSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...collectAgentSources(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

describe('human-only site-lifecycle gates (orchestrator §0.1)', () => {
  const files = collectAgentSources(SRC_ROOT);

  it('finds a meaningful set of agent source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no agent source references a human-only approve/create/go-live action', () => {
    const offenders: Array<{ file: string; symbol: string }> = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const sym of FORBIDDEN) {
        if (text.includes(sym)) {
          offenders.push({ file: path.relative(SRC_ROOT, file), symbol: sym });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
