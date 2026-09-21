import type { RunningPageConfig } from './schema';

const yamlQuote = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

export const toConfigYml = (config: RunningPageConfig): string => {
  const { appearance } = config;
  const { goals } = appearance;
  return `# Running Page 3.0 配置文件
# 由 /admin 配置页生成，也可继续手动编辑。

# ── 地图 ──────────────────────────────────────────────────────────────────────

mapbox_token: ${yamlQuote(appearance.mapbox_token)}

# ── 外观 ─────────────────────────────────────────────────────────────────────

avatar: ${yamlQuote(appearance.avatar)}
locale: ${appearance.locale}
theme: ${appearance.theme}
theme_preset: ${appearance.theme_preset}

# ── 运动目标 ──────────────────────────────────────────────────────────────────
# unit: distance → 单位 km

goals:
  all:
    yearly: ${goals.yearly}
    monthly: ${goals.monthly}
    weekly: ${goals.weekly}
    unit: ${goals.unit}

  Run:
    yearly: ${goals.yearly}
    monthly: ${goals.monthly}
    weekly: ${goals.weekly}
    unit: ${goals.unit}
`;
};

export const toSiteMetadataTs = (config: RunningPageConfig): string => {
  const { site } = config;
  const links = site.navLinks
    .map((link) => {
      const isInternal = link.url.startsWith('/');
      const urlExpr = isInternal
        ? `\`\${getBasePath()}${link.url}\``
        : JSON.stringify(link.url);
      return `    {
      name: ${JSON.stringify(link.name)},
      url: ${urlExpr},
    }`;
    })
    .join(',\n');

  return `interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  description: string;
  logo: string;
  navLinks: {
    name: string;
    url: string;
  }[];
}

const getBasePath = () => {
  const baseUrl = import.meta.env.BASE_URL;
  return baseUrl === '/' ? '' : baseUrl;
};

const data: ISiteMetadataResult = {
  siteTitle: ${JSON.stringify(site.siteTitle)},
  siteUrl: ${JSON.stringify(site.siteUrl)},
  logo: ${JSON.stringify(site.logo)},
  description: ${JSON.stringify(site.description)},
  navLinks: [
${links}
  ],
};

export default data;
`;
};

const replaceEnv = (
  source: string,
  key: string,
  value: string | number | boolean
): string => {
  const rendered = typeof value === 'boolean' ? String(value) : String(value);
  const pattern = new RegExp(`^  ${key}:.*$`, 'm');
  if (!pattern.test(source)) {
    throw new Error(`workflow 中找不到环境变量 ${key}`);
  }
  return source.replace(pattern, `  ${key}: ${rendered}`);
};

export const patchWorkflowEnv = (
  source: string,
  config: RunningPageConfig
): string => {
  const { sync } = config;
  let next = source;
  next = replaceEnv(next, 'RUN_TYPE', sync.runType);
  next = replaceEnv(next, 'ATHLETE', sync.athlete);
  next = replaceEnv(next, 'TITLE', sync.title);
  next = replaceEnv(next, 'MIN_GRID_DISTANCE', sync.minGridDistance);
  next = replaceEnv(next, 'TITLE_GRID', sync.titleGrid);
  next = replaceEnv(next, 'USE_CLOUDFLARE_WARP', sync.useCloudflareWarp);
  next = replaceEnv(next, 'HUAWEI_BRIDGE', sync.huaweiBridge);
  next = replaceEnv(next, 'IGNORE_START_END_RANGE', sync.ignoreStartEndRange);
  return next;
};
