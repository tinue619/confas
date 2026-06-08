import type { CapacitorConfig } from '@capacitor/cli';

// App ID (kz.tinue.confas) и displayName видны на устройстве.
// webDir — куда vite build кладёт статику; cap copy её забирает в нативный проект.
const config: CapacitorConfig = {
  appId: 'kz.tinue.confas',
  appName: 'Фасады',
  webDir: 'dist',
};

export default config;
