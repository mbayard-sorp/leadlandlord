#!/usr/bin/env -S tsx
// @ts-ignore - direct relative import; package only exports ./loader
import { rankCities } from '../packages/us-cities/src/city-ranker.js';

const states7 = ['AZ', 'NM', 'TX', 'NV', 'CO', 'UT', 'OK'];
const states4 = ['AZ', 'NM', 'TX', 'NV'];

for (const states of [states4, states7]) {
  const r = rankCities({ limit: 150, perStateCap: 12, states });
  console.log(`states=${states.join(',')} -> ${r.length} cities`);
  const byState: Record<string, number> = {};
  for (const c of r) byState[c.state] = (byState[c.state] ?? 0) + 1;
  console.log('  per-state:', byState);
  console.log('  sample top 5:', r.slice(0, 5).map((c) => `${c.city},${c.state} (${c.score.toFixed(2)})`));
}
