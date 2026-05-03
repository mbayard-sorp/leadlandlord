import { spawn } from 'node:child_process';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import type { DeployArgs, DeployResult } from './types.js';

/**
 * Deploy a directory to Vercel.
 *
 * Phase 1 implementation: shells out to the `vercel` CLI which handles file
 * upload, project linking, build, and status polling for us. The CLI must be
 * installed (`pnpm add -g vercel`) and `VERCEL_TOKEN` must be in env.
 *
 * Phase 2 plan: replace with raw POST to `https://api.vercel.com/v13/deployments`,
 * which requires pre-uploading each file via POST /v2/files (SHA-1 indexed) and
 * polling /v13/deployments/:id for build status. Worth it for headless cron
 * deploys where shelling out is awkward; not worth it for the dry-run path.
 */
export async function deployDirectory(args: DeployArgs): Promise<DeployResult> {
  const startedAt = Date.now();
  const cliArgs = ['deploy', '--yes', '--token', requireToken()];
  if (args.prebuilt) cliArgs.push('--prebuilt');
  if (args.prod) cliArgs.push('--prod');
  if (process.env.VERCEL_TEAM_ID) cliArgs.push('--scope', process.env.VERCEL_TEAM_ID);
  cliArgs.push('--name', args.projectName);

  log.info({ projectName: args.projectName, cwd: args.cwd }, 'vercel deploy starting');

  const { stdout, stderr, code } = await runCli('vercel', cliArgs, args.cwd, args.envVars ?? {});

  if (code !== 0) {
    throw new IntegrationError('vercel-cli', `vercel deploy exited ${code}: ${stderr.slice(-2000)}`);
  }

  const url = extractUrl(stdout) ?? extractUrl(stderr);
  if (!url) {
    throw new IntegrationError('vercel-cli', 'Could not parse preview URL from CLI output');
  }

  return {
    url: url.startsWith('http') ? url : `https://${url}`,
    durationMs: Date.now() - startedAt,
  };
}

function requireToken(): string {
  const t = process.env.VERCEL_TOKEN;
  if (!t) throw new IntegrationError('vercel-cli', 'VERCEL_TOKEN is not set');
  return t;
}

function extractUrl(output: string): string | null {
  const match = output.match(/https?:\/\/[a-z0-9-]+\.vercel\.app/i);
  return match?.[0] ?? null;
}

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(cmd: string, args: string[], cwd: string, env: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      log.debug({ stream: 'stdout' }, s.trim());
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      log.debug({ stream: 'stderr' }, s.trim());
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}
