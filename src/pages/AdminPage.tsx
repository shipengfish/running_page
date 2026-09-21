import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import '../themes/dashboard/index.css';
import {
  DEFAULT_CONFIG,
  SECRET_FIELDS,
  type RunningPageConfig,
  type SecretUpdates,
} from '../admin/schema';

const TOKEN_KEY = 'running-admin-token';

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const api = async <T,>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders(token),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || `请求失败 ${response.status}`);
  }
  return body;
};

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-muted)]';
const cardClass =
  'rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5';

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

export default function AdminPage() {
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [config, setConfig] = useState<RunningPageConfig>(DEFAULT_CONFIG);
  const [secrets, setSecrets] = useState<SecretUpdates>({});
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loggedIn = Boolean(token);

  const loadConfig = async (nextToken: string) => {
    const data = await api<{
      config: RunningPageConfig;
      githubConfigured: boolean;
    }>('/api/admin/config', nextToken);
    setConfig(data.config);
    setGithubConfigured(data.githubConfigured);
  };

  useEffect(() => {
    document.title = '配置 · Running Page';
    document.documentElement.classList.remove('dark');
    if (!token) return;
    setLoading(true);
    loadConfig(token)
      .catch((err: Error) => {
        sessionStorage.removeItem(TOKEN_KEY);
        setToken('');
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api('/api/admin/session', tokenInput, { method: 'POST' });
      sessionStorage.setItem(TOKEN_KEY, tokenInput);
      setToken(tokenInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const save = async (applyToGithub: boolean) => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const result = await api<{ ok: boolean; githubFiles?: string[] }>(
        '/api/admin/config',
        token,
        {
          method: 'PUT',
          body: JSON.stringify({
            config,
            secrets,
            applyToGithub,
          }),
        }
      );
      setSecrets({});
      if (applyToGithub) {
        setMessage(
          result.githubFiles?.length
            ? `已写回 GitHub：${result.githubFiles.join('、')}`
            : '已保存并尝试写回 GitHub'
        );
      } else {
        setMessage('已保存到 Cloudflare KV。公开站点会在下次部署后更新。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const triggerSync = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api('/api/admin/sync', token, { method: 'POST' });
      setMessage('已触发 GitHub Actions 同步。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发失败');
    } finally {
      setLoading(false);
    }
  };

  const updateAppearance = <K extends keyof RunningPageConfig['appearance']>(
    key: K,
    value: RunningPageConfig['appearance'][K]
  ) => {
    setConfig((prev) => ({
      ...prev,
      appearance: { ...prev.appearance, [key]: value },
    }));
  };

  const navPreview = useMemo(
    () => config.site.navLinks.map((item) => item.name).join(' / ') || '无',
    [config.site.navLinks]
  );

  if (!loggedIn) {
    return (
      <div className="dashboard min-h-screen bg-[var(--color-bg)] px-4 py-16 text-[var(--color-text)]">
        <form
          onSubmit={login}
          className="mx-auto max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-8"
        >
          <p className="text-xs font-medium tracking-wide text-[var(--color-muted)]">
            RUNNING.PAGE
          </p>
          <h1 className="mt-2 text-2xl font-semibold">配置后台</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            输入管理员口令。口令只存在当前浏览器会话，不会写进页面。
          </p>
          <div className="mt-6">
            <Field label="管理员口令">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                required
              />
            </Field>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-[var(--color-on-accent)] disabled:opacity-60"
          >
            {loading ? '验证中…' : '进入'}
          </button>
          <a
            href="/"
            className="mt-4 block text-center text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            返回跑步首页
          </a>
        </form>
      </div>
    );
  }

  return (
    <div className="dashboard min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <div className="text-lg font-bold">
              配置<span className="text-[var(--color-run)]">.</span>后台
            </div>
            <div className="text-xs text-[var(--color-muted)]">
              GitHub 写回{githubConfigured ? '已接通' : '未配置 GITHUB_TOKEN'}
            </div>
          </div>
          <div className="flex gap-2">
            <a
              href="/"
              className="rounded-lg px-3 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-text)]"
            >
              首页
            </a>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem(TOKEN_KEY);
                setToken('');
              }}
              className="rounded-lg px-3 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-card)]"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}

        <section className={cardClass}>
          <h2 className="text-base font-semibold">外观与年度目标</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            对应 `config.yml`：主题、语言、头像和年/月/周目标。
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="头像 URL">
              <input
                className={inputClass}
                value={config.appearance.avatar}
                onChange={(event) =>
                  updateAppearance('avatar', event.target.value)
                }
              />
            </Field>
            <Field label="语言">
              <select
                className={inputClass}
                value={config.appearance.locale}
                onChange={(event) =>
                  updateAppearance(
                    'locale',
                    event.target.value as RunningPageConfig['appearance']['locale']
                  )
                }
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="颜色主题">
              <select
                className={inputClass}
                value={config.appearance.theme}
                onChange={(event) =>
                  updateAppearance(
                    'theme',
                    event.target.value as RunningPageConfig['appearance']['theme']
                  )
                }
              >
                <option value="light">浅色</option>
                <option value="dark">深色</option>
                <option value="system">跟随系统</option>
              </select>
            </Field>
            <Field label="界面预设">
              <select
                className={inputClass}
                value={config.appearance.theme_preset}
                onChange={(event) =>
                  updateAppearance(
                    'theme_preset',
                    event.target.value as RunningPageConfig['appearance']['theme_preset']
                  )
                }
              >
                <option value="dashboard">Dashboard 3.0</option>
                <option value="classic">Classic</option>
              </select>
            </Field>
            <Field label="年目标（km）">
              <input
                className={inputClass}
                type="number"
                min={0}
                value={config.appearance.goals.yearly}
                onChange={(event) =>
                  updateAppearance('goals', {
                    ...config.appearance.goals,
                    yearly: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="月目标（km）">
              <input
                className={inputClass}
                type="number"
                min={0}
                value={config.appearance.goals.monthly}
                onChange={(event) =>
                  updateAppearance('goals', {
                    ...config.appearance.goals,
                    monthly: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="周目标（km）">
              <input
                className={inputClass}
                type="number"
                min={0}
                value={config.appearance.goals.weekly}
                onChange={(event) =>
                  updateAppearance('goals', {
                    ...config.appearance.goals,
                    weekly: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Mapbox Token（可空）">
              <input
                className={inputClass}
                value={config.appearance.mapbox_token}
                onChange={(event) =>
                  updateAppearance('mapbox_token', event.target.value)
                }
              />
            </Field>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="text-base font-semibold">站点信息</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            对应 `src/static/site-metadata.ts`。当前导航：{navPreview}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="站点标题">
              <input
                className={inputClass}
                value={config.site.siteTitle}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    site: { ...prev.site, siteTitle: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="站点 URL">
              <input
                className={inputClass}
                value={config.site.siteUrl}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    site: { ...prev.site, siteUrl: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="简介">
              <input
                className={inputClass}
                value={config.site.description}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    site: { ...prev.site, description: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="Logo URL">
              <input
                className={inputClass}
                value={config.site.logo}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    site: { ...prev.site, logo: event.target.value },
                  }))
                }
              />
            </Field>
          </div>
          <div className="mt-4 space-y-3">
            {config.site.navLinks.map((link, index) => (
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]" key={`${link.name}-${index}`}>
                <input
                  className={inputClass}
                  value={link.name}
                  placeholder="名称"
                  onChange={(event) => {
                    const navLinks = [...config.site.navLinks];
                    navLinks[index] = { ...link, name: event.target.value };
                    setConfig((prev) => ({
                      ...prev,
                      site: { ...prev.site, navLinks },
                    }));
                  }}
                />
                <input
                  className={inputClass}
                  value={link.url}
                  placeholder="链接"
                  onChange={(event) => {
                    const navLinks = [...config.site.navLinks];
                    navLinks[index] = { ...link, url: event.target.value };
                    setConfig((prev) => ({
                      ...prev,
                      site: { ...prev.site, navLinks },
                    }));
                  }}
                />
                <button
                  type="button"
                  className="rounded-lg px-3 text-sm text-[var(--color-muted)] hover:bg-[var(--color-bg)]"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      site: {
                        ...prev.site,
                        navLinks: prev.site.navLinks.filter((_, i) => i !== index),
                      },
                    }))
                  }
                >
                  删除
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-sm text-[var(--color-accent)]"
              onClick={() =>
                setConfig((prev) => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    navLinks: [...prev.site.navLinks, { name: '', url: '' }],
                  },
                }))
              }
            >
              + 添加导航
            </button>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="text-base font-semibold">同步策略</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            对应 GitHub Actions 环境变量。佳明用 garmin_cn，华为走悦跑圈桥接。
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="主数据源 RUN_TYPE">
              <input
                className={inputClass}
                value={config.sync.runType}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: { ...prev.sync, runType: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="华为桥接">
              <select
                className={inputClass}
                value={config.sync.huaweiBridge}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: {
                      ...prev.sync,
                      huaweiBridge: event.target.value as RunningPageConfig['sync']['huaweiBridge'],
                    },
                  }))
                }
              >
                <option value="joyrun">悦跑圈</option>
                <option value="none">关闭</option>
              </select>
            </Field>
            <Field label="Athlete">
              <input
                className={inputClass}
                value={config.sync.athlete}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: { ...prev.sync, athlete: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="海报标题">
              <input
                className={inputClass}
                value={config.sync.title}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: { ...prev.sync, title: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="网格最小距离（km）">
              <input
                className={inputClass}
                type="number"
                min={0}
                value={config.sync.minGridDistance}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: {
                      ...prev.sync,
                      minGridDistance: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="起终点裁剪（米）">
              <input
                className={inputClass}
                type="number"
                min={0}
                value={config.sync.ignoreStartEndRange}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: {
                      ...prev.sync,
                      ignoreStartEndRange: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="佳明走 Cloudflare WARP">
              <select
                className={inputClass}
                value={String(config.sync.useCloudflareWarp)}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    sync: {
                      ...prev.sync,
                      useCloudflareWarp: event.target.value === 'true',
                    },
                  }))
                }
              >
                <option value="false">关闭</option>
                <option value="true">打开</option>
              </select>
            </Field>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="text-base font-semibold">密钥保险箱</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            只写不回显。留空表示不修改 GitHub Secrets。
          </p>
          <div className="mt-4 grid gap-4">
            {SECRET_FIELDS.map((field) => (
              <Field key={field.key} label={field.label}>
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="off"
                  placeholder="留空则不修改"
                  value={secrets[field.key] ?? ''}
                  onChange={(event) =>
                    setSecrets((prev) => ({
                      ...prev,
                      [field.key]: event.target.value,
                    }))
                  }
                />
                <span className="mt-1 block text-xs text-[var(--color-muted)]">
                  {field.hint}
                </span>
              </Field>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-3 pb-10">
          <button
            type="button"
            disabled={loading}
            onClick={() => save(false)}
            className="rounded-lg bg-[var(--color-card)] px-4 py-2.5 text-sm font-medium ring-1 ring-[var(--color-border)] disabled:opacity-60"
          >
            保存到 Cloudflare
          </button>
          <button
            type="button"
            disabled={loading || !githubConfigured}
            onClick={() => save(true)}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-[var(--color-on-accent)] disabled:opacity-60"
          >
            保存并写回 GitHub
          </button>
          <button
            type="button"
            disabled={loading || !githubConfigured}
            onClick={triggerSync}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--color-text)] ring-1 ring-[var(--color-border)] disabled:opacity-60"
          >
            立即同步数据
          </button>
        </div>
      </main>
    </div>
  );
}
