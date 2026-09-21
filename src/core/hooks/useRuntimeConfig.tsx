import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AVATAR,
  DEFAULT_GOAL,
  DEFAULT_LOCALE,
  GOALS,
  type GoalConfig,
} from '../config';
import type { Locale } from '../i18n';

export interface RuntimeConfig {
  goals: Record<string, GoalConfig>;
  avatar: string;
  locale: Locale;
  siteTitle?: string;
  siteUrl?: string;
}

const baked: RuntimeConfig = {
  goals: GOALS,
  avatar: AVATAR,
  locale: DEFAULT_LOCALE,
};

const RuntimeConfigContext = createContext<RuntimeConfig>(baked);

const toGoalMap = (goals?: Partial<GoalConfig>): Record<string, GoalConfig> => {
  const merged: GoalConfig = {
    ...DEFAULT_GOAL,
    ...goals,
  };
  return {
    ...GOALS,
    all: merged,
    Run: merged,
  };
};

type PublicConfigResponse = {
  config?: {
    appearance?: {
      goals?: GoalConfig;
      avatar?: string;
      locale?: Locale;
    };
    site?: {
      siteTitle?: string;
      siteUrl?: string;
    };
  };
};

export function RuntimeConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<RuntimeConfig>(baked);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/public-config', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: PublicConfigResponse | null) => {
        const appearance = body?.config?.appearance;
        if (!appearance) return;
        setConfig({
          goals: toGoalMap(appearance.goals),
          avatar: appearance.avatar || AVATAR,
          locale: appearance.locale || DEFAULT_LOCALE,
          siteTitle: body?.config?.site?.siteTitle,
          siteUrl: body?.config?.site?.siteUrl,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        // Local vite without wrangler: keep baked config.yml values.
      });
    return () => controller.abort();
  }, []);

  const value = useMemo(() => config, [config]);
  return (
    <RuntimeConfigContext.Provider value={value}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(RuntimeConfigContext);
}
