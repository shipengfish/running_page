import sealedBox from 'tweetnacl-sealedbox-js';
import {
  DEFAULT_CONFIG,
  type RunningPageConfig,
  type SecretUpdates,
} from '../src/admin/schema';
import {
  patchWorkflowEnv,
  toConfigYml,
  toSiteMetadataTs,
} from '../src/admin/files';

export interface Env {
  CONFIG: KVNamespace;
  ADMIN_TOKEN: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO: string;
}

const CONFIG_KEY = 'running-page-config';
const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const publicConfig = (config: RunningPageConfig) => ({
  appearance: {
    ...config.appearance,
    mapbox_token: config.appearance.mapbox_token ? 'configured' : '',
  },
  site: config.site,
  sync: {
    ...config.sync,
  },
});

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: jsonHeaders });

const timingSafeEqual = (left: string, right: string): boolean => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const max = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
};

const requireAdmin = (request: Request, env: Env): Response | null => {
  if (!env.ADMIN_TOKEN) {
    return json({ error: '未配置 ADMIN_TOKEN' }, 503);
  }
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return json({ error: '未授权' }, 401);
  }
  return null;
};

const readConfig = async (env: Env): Promise<RunningPageConfig> => {
  const stored = await env.CONFIG.get(CONFIG_KEY, 'json');
  if (!stored) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...(stored as RunningPageConfig),
    appearance: {
      ...DEFAULT_CONFIG.appearance,
      ...(stored as RunningPageConfig).appearance,
      goals: {
        ...DEFAULT_CONFIG.appearance.goals,
        ...(stored as RunningPageConfig).appearance?.goals,
      },
    },
    site: {
      ...DEFAULT_CONFIG.site,
      ...(stored as RunningPageConfig).site,
      navLinks:
        (stored as RunningPageConfig).site?.navLinks ??
        DEFAULT_CONFIG.site.navLinks,
    },
    sync: {
      ...DEFAULT_CONFIG.sync,
      ...(stored as RunningPageConfig).sync,
      huaweiBridge: 'none',
    },
  };
};

const githubHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'huanxi-running-admin',
});

const requireGithub = (env: Env): string => {
  if (!env.GITHUB_TOKEN) {
    throw new Error('未配置 GITHUB_TOKEN，无法写回仓库或触发同步');
  }
  return env.GITHUB_TOKEN;
};

const getFile = async (
  repo: string,
  path: string,
  token: string
): Promise<{ sha: string; content: string }> => {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    { headers: githubHeaders(token) }
  );
  if (!response.ok) {
    throw new Error(`读取 ${path} 失败：${response.status}`);
  }
  const body = (await response.json()) as { sha: string; content: string };
  return {
    sha: body.sha,
    content: atob(body.content.replace(/\n/g, '')),
  };
};

const putFile = async (
  repo: string,
  path: string,
  content: string,
  sha: string,
  message: string,
  token: string
): Promise<void> => {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        ...githubHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        sha,
        branch: 'master',
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`写入 ${path} 失败：${response.status} ${text}`);
  }
};

const b64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bytesToB64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const putGithubSecret = async (
  repo: string,
  name: string,
  value: string,
  token: string
): Promise<void> => {
  const keyResponse = await fetch(
    `https://api.github.com/repos/${repo}/actions/secrets/public-key`,
    { headers: githubHeaders(token) }
  );
  if (!keyResponse.ok) {
    throw new Error(`读取 GitHub secrets 公钥失败：${keyResponse.status}`);
  }
  const keyBody = (await keyResponse.json()) as {
    key: string;
    key_id: string;
  };
  const encrypted = sealedBox.seal(
    new TextEncoder().encode(value),
    b64ToBytes(keyBody.key)
  );
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/secrets/${name}`,
    {
      method: 'PUT',
      headers: {
        ...githubHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        encrypted_value: bytesToB64(encrypted),
        key_id: keyBody.key_id,
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`写入密钥 ${name} 失败：${response.status} ${text}`);
  }
};

const applyToGithub = async (
  env: Env,
  config: RunningPageConfig,
  secrets: SecretUpdates
): Promise<string[]> => {
  const token = requireGithub(env);
  const repo = env.GITHUB_REPO;
  const changed: string[] = [];

  const yml = await getFile(repo, 'config.yml', token);
  await putFile(
    repo,
    'config.yml',
    toConfigYml(config),
    yml.sha,
    'chore: update running page config from /admin',
    token
  );
  changed.push('config.yml');

  const metadata = await getFile(repo, 'src/static/site-metadata.ts', token);
  await putFile(
    repo,
    'src/static/site-metadata.ts',
    toSiteMetadataTs(config),
    metadata.sha,
    'chore: update site metadata from /admin',
    token
  );
  changed.push('src/static/site-metadata.ts');

  const workflow = await getFile(
    repo,
    '.github/workflows/run_data_sync.yml',
    token
  );
  await putFile(
    repo,
    '.github/workflows/run_data_sync.yml',
    patchWorkflowEnv(workflow.content, config),
    workflow.sha,
    'chore: update sync env from /admin',
    token
  );
  changed.push('.github/workflows/run_data_sync.yml');

  for (const [name, value] of Object.entries(secrets)) {
    if (!value) continue;
    await putGithubSecret(repo, name, value, token);
    changed.push(`secret:${name}`);
  }

  return changed;
};

const dispatchSync = async (env: Env): Promise<void> => {
  const token = requireGithub(env);
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/run_data_sync.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        ...githubHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'master' }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`触发同步失败：${response.status} ${text}`);
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : '服务异常';
      return json({ error: message }, 500);
    }
  },
};

const handle = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    return json({ ok: true });
  }

  if (url.pathname === '/api/public-config' && request.method === 'GET') {
    const config = await readConfig(env);
    return json({ config: publicConfig(config) });
  }

  if (url.pathname === '/api/admin/session' && request.method === 'POST') {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
    return json({ ok: true });
  }

  if (url.pathname === '/api/admin/config' && request.method === 'GET') {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
    const config = await readConfig(env);
    return json({
      config,
      githubConfigured: Boolean(env.GITHUB_TOKEN),
      secrets: {
        GARMIN_SECRET_STRING_CN: false,
        MAPBOX_TOKEN: false,
      },
    });
  }

  if (url.pathname === '/api/admin/config' && request.method === 'PUT') {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
    const body = (await request.json()) as {
      config?: RunningPageConfig;
      secrets?: SecretUpdates;
      applyToGithub?: boolean;
    };
    if (!body.config) return json({ error: '缺少 config' }, 400);
    body.config = {
      ...body.config,
      sync: { ...body.config.sync, huaweiBridge: 'none' },
    };
    await env.CONFIG.put(CONFIG_KEY, JSON.stringify(body.config));
    let githubFiles: string[] = [];
    if (body.applyToGithub) {
      githubFiles = await applyToGithub(env, body.config, body.secrets ?? {});
    }
    return json({ ok: true, githubFiles });
  }

  if (url.pathname === '/api/admin/sync' && request.method === 'POST') {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
    await dispatchSync(env);
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
};
