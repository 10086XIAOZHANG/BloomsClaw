import type { ProLayoutProps } from '@ant-design/pro-components';

/**
 * BloomsClaw 设计系统 — 由 ui-ux-pro-max 生成
 * Pattern: Real-Time / Operations | Style: Glassmorphism
 * Colors: Dark tech + status green | Type: Fira Code / Fira Sans
 * 详见 design-system/blooms-claw/MASTER.md
 */
const Settings: ProLayoutProps & {
  pwa?: boolean;
  logo?: string;
} = {
  navTheme: 'realDark',
  colorPrimary: '#22C55E',
  layout: 'mix',
  contentWidth: 'Fluid',
  fixedHeader: true,
  fixSiderbar: true,
  colorWeak: false,
  title: 'BloomsClaw',
  pwa: true,
  logo: '/favicon.svg',
  iconfontUrl: '',
  token: {
    sider: {
      colorMenuBackground: '#0F172A',
      colorTextMenu: '#94A3B8',
      colorTextMenuSelected: '#F8FAFC',
      colorBgMenuItemSelected: 'rgba(34, 197, 94, 0.16)',
    },
    header: {
      colorBgHeader: 'rgba(15, 23, 42, 0.72)',
      colorTextRightActionsItem: '#94A3B8',
    },
    pageContainer: {
      colorBgPageContainer: '#0F172A',
    },
  },
};

export default Settings;
