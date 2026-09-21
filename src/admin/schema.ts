export type LocaleOption = 'zh' | 'en';
export type ThemeOption = 'light' | 'dark' | 'system';
export type ThemePreset = 'dashboard' | 'classic';
export type HuaweiBridge = 'joyrun' | 'none';

export interface NavLinkConfig {
  name: string;
  url: string;
}

export interface RunningPageConfig {
  appearance: {
    avatar: string;
    locale: LocaleOption;
    theme: ThemeOption;
    theme_preset: ThemePreset;
    mapbox_token: string;
    goals: {
      yearly: number;
      monthly: number;
      weekly: number;
      unit: 'distance' | 'time';
    };
  };
  site: {
    siteTitle: string;
    siteUrl: string;
    description: string;
    logo: string;
    navLinks: NavLinkConfig[];
  };
  sync: {
    runType: string;
    athlete: string;
    title: string;
    minGridDistance: number;
    titleGrid: string;
    useCloudflareWarp: boolean;
    huaweiBridge: HuaweiBridge;
    ignoreStartEndRange: number;
  };
}

export interface SecretUpdates {
  GARMIN_SECRET_STRING_CN?: string;
  JOYRUN_UID?: string;
  JOYRUN_SID?: string;
  MAPBOX_TOKEN?: string;
}

export const DEFAULT_CONFIG: RunningPageConfig = {
  appearance: {
    avatar:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQTtc69JxHNcmN1ETpMUX4dozAgAN6iPjWalQ&usqp=CAU',
    locale: 'zh',
    theme: 'light',
    theme_preset: 'dashboard',
    mapbox_token: '',
    goals: {
      yearly: 2000,
      monthly: 150,
      weekly: 35,
      unit: 'distance',
    },
  },
  site: {
    siteTitle: 'Running Page',
    siteUrl: 'https://huanxi.me',
    description: 'Personal site and blog',
    logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQTtc69JxHNcmN1ETpMUX4dozAgAN6iPjWalQ&usqp=CAU',
    navLinks: [
      { name: 'Summary', url: '/summary' },
      { name: 'Blog', url: 'https://huanxi.me' },
    ],
  },
  sync: {
    runType: 'garmin_cn',
    athlete: 'huanxi',
    title: 'huanxi Running',
    minGridDistance: 10,
    titleGrid: 'Over 10km Runs',
    useCloudflareWarp: false,
    huaweiBridge: 'joyrun',
    ignoreStartEndRange: 10,
  },
};

export const SECRET_FIELDS: {
  key: keyof SecretUpdates;
  label: string;
  hint: string;
}[] = [
  {
    key: 'GARMIN_SECRET_STRING_CN',
    label: '佳明国区密钥',
    hint: '本机 python run_page/get_garmin_secret.py 邮箱 密码 --is-cn 的输出',
  },
  {
    key: 'JOYRUN_UID',
    label: '悦跑圈 UID',
    hint: 'joyrun_sync 登录成功后打印的 uid',
  },
  {
    key: 'JOYRUN_SID',
    label: '悦跑圈 SID',
    hint: '单设备有效；手机再登录会失效',
  },
  {
    key: 'MAPBOX_TOKEN',
    label: 'Mapbox Token',
    hint: '可留空，站点默认走免费地图',
  },
];
