export interface VercelProject {
  id: string;
  name: string;
  accountId: string;
  framework?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface VercelDeployment {
  id: string;
  url: string;
  name: string;
  state: 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'QUEUED' | 'INITIALIZING';
  inspectorUrl?: string;
  createdAt: number;
}

export interface DeployArgs {
  projectName: string;
  cwd: string;
  prebuilt?: boolean;
  prod?: boolean;
  envVars?: Record<string, string>;
}

export interface DeployResult {
  url: string;
  inspectorUrl?: string;
  durationMs: number;
}
