import { spawn } from 'node:child_process';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import type { DeployArgs, DeployResult } from './types.js';

/**
 * Deploy a directory to Vercel.
 *
 * Phase 1: shells out to the `vercel` CLI which handles file upload, project
 * linking, build, and status polling for us. The CLI must be installed
 * (`pnpm add -g vercel`) and `VERCEL_TOKEN` must be in env.
 *
 * Flow per deploy:
 *   1. `vercel link --yes --project <name> --scope <team>` — associate the temp
 *       cwd with the project we already created via the REST API.
 *   2. `vercel deploy --yes --scope <team>` — upload + build + return URL.
 *
 * Phase 2: replace with raw POST to api.vercel.com/v13/deployments — needed for
 * headless cron deploys where shelling out is awkward.
 */
export async function deployDirectory(args: DeployArgs): Promise<DeployResult> {
  const startedAt = Date.now();
  const token = requireToken();
  const scope = process.env.VERCEL_TEAM_ID;

  if (!scope) {
    throw new IntegrationError(
      'vercel-cli',
      'VERCEL_TEAM_ID is required (your Vercel team slug). Set it in .env.local.',
    );
  }

  // Step 1: link the temp dir to the existing project.
  const linkArgs = [
    'link',
    '--yes',
    '--token',
    token,
    '--project',
    args.projectName,
    '--scope',
    scope,
  ];
  log.info({ projectName: args.projectName, cwd: args.cwd }, 'vercel link starting');
  const linkRes = await runCli('vercel', linkArgs, args.cwd, args.envVars ?? {});
  if (linkRes.code !== 0) {
    throw new IntegrationError(
      'vercel-cli',
      `vercel link exited ${linkRes.code}: ${linkRes.stderr.slice(-1500)}`,
    );
  }

  // Step 2: deploy.
  const deployArgs = ['deploy', '--yes', '--token', token, '--scope', scope];
  if (args.prebuilt) deployArgs.push('--prebuilt');
  if (args.prod) deployArgs.push('--prod');

  log.info({ projectName: args.projectName, cwd: args.cwd }, 'vercel deploy starting');
  const { stdout, stderr, code } = await runCli('vercel', deployArgs, args.cwd, args.envVars ?? {});
  if (code !== 0) {
    throw new IntegrationError(
      'vercel-cli',
      `vercel deploy exited ${code}: ${stderr.slice(-2000)}`,
    );
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
