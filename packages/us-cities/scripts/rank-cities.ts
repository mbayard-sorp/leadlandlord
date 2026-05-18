/**
 * Developer diagnostic: rank US cities and print a table.
 *
 * Usage:
 *   pnpm --filter @leadlandlord/us-cities rank
 *   pnpm --filter @leadlandlord/us-cities rank -- --limit=20
 *   pnpm --filter @leadlandlord/us-cities rank -- --state=KY,TN
 *   pnpm --filter @leadlandlord/us-cities rank -- --limit=50 --show-subscores
 */

import { rankCities } from '../src/city-ranker.js';

// ---------------------------------------------------------------------------
// Arg parsing (no library — process.argv only)
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 20;
  let states: string[] | undefined;
  let showSubscores = false;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.slice('--limit='.length), 10) || 20;
    } else if (arg.startsWith('--state=')) {
      states = arg
        .slice('--state='.length)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (arg === '--show-subscores') {
      showSubscores = true;
    }
  }

  return { limit, states, showSubscores };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function pad(s: string, width: number, right = false): string {
  if (right) return s.padStart(width);
  return s.padEnd(width);
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDollar(n: number): string {
  return '$' + fmt(Math.round(n / 1000)) + 'k';
}

function whySummary(city: ReturnType<typeof rankCities>[0]): string {
  const notes: string[] = [];
  if ((city.ownerOccupiedPct ?? 0) >= 0.70) notes.push('strong OO');
  else if ((city.ownerOccupiedPct ?? 0) >= 0.60) notes.push('good OO');
  if ((city.medianIncome ?? 0) >= 75_000) notes.push('high income');
  if ((city.medianHomeValue ?? 0) >= 300_000) notes.push('premium market');
  if (city.metroDensityMult < 1.0) notes.push(`metro ×${city.metroDensityMult}`);
  if (city.missingDataHaircut < 1.0) notes.push('data haircut');
  if (notes.length === 0) notes.push('adequate fundamentals');
  return notes.join(', ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const { limit, states, showSubscores } = parseArgs();

  console.log(`\nRanking cities (limit=${limit}${states ? `, states=${states.join(',')}` : ''})...\n`);

  console.time('rankCities');
  const results = rankCities({ limit, states });
  console.timeEnd('rankCities');

  if (results.length === 0) {
    console.log('No cities passed the hard filters. Run scripts/enrich-from-census.ts first.');
    process.exit(0);
  }

  if (showSubscores) {
    // Verbose mode — two rows per city
    const hdr =
      pad('Rank', 5) +
      pad('City', 32) +
      pad('Pop', 8, true) +
      pad('OO%', 6, true) +
      pad('MedInc', 9, true) +
      pad('MedHome', 10, true) +
      pad('Age', 5, true) +
      pad('Score', 7, true) +
      '  S1    S2    S3    S4    S5  Prox  Why';
    console.log(hdr);
    console.log('-'.repeat(hdr.length));

    results.forEach((c, i) => {
      const pop = c.populationCensus ?? c.population;
      const line1 =
        pad(String(i + 1), 5) +
        pad(`${c.city}, ${c.state}`, 32) +
        pad(fmt(pop), 8, true) +
        pad(((c.ownerOccupiedPct ?? 0) * 100).toFixed(0) + '%', 6, true) +
        pad(fmtDollar(c.medianIncome ?? 0), 9, true) +
        pad(fmtDollar(c.medianHomeValue ?? 0), 10, true) +
        pad(String(c.medianAge ?? '?'), 5, true) +
        pad(c.score.toFixed(3), 7, true) +
        `  ${c.subscores.s1_ownerOccupied.toFixed(2)}  ${c.subscores.s2_wealth.toFixed(2)}  ${c.subscores.s3_housingUnits.toFixed(2)}  ${c.subscores.s4_popBand.toFixed(2)}  ${c.subscores.s5_age.toFixed(2)}  ${c.metroDensityMult.toFixed(2)}  ${whySummary(c)}`;
      console.log(line1);
    });
  } else {
    // Compact mode
    const hdr =
      pad('Rank', 5) +
      pad('City', 32) +
      pad('Pop', 8, true) +
      pad('OO%', 6, true) +
      pad('MedInc', 9, true) +
      pad('MedHome', 10, true) +
      pad('Age', 5, true) +
      pad('Score', 7, true) +
      '  Why';
    console.log(hdr);
    console.log('-'.repeat(hdr.length));

    results.forEach((c, i) => {
      const pop = c.populationCensus ?? c.population;
      const line =
        pad(String(i + 1), 5) +
        pad(`${c.city}, ${c.state}`, 32) +
        pad(fmt(pop), 8, true) +
        pad(((c.ownerOccupiedPct ?? 0) * 100).toFixed(0) + '%', 6, true) +
        pad(fmtDollar(c.medianIncome ?? 0), 9, true) +
        pad(fmtDollar(c.medianHomeValue ?? 0), 10, true) +
        pad(String(c.medianAge ?? '?'), 5, true) +
        pad(c.score.toFixed(3), 7, true) +
        `  ${whySummary(c)}`;
      console.log(line);
    });
  }

  console.log(`\nTotal: ${results.length} cities shown (of top ${limit} requested)\n`);
}

main();
