import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lucas.todotree',
  appName: 'TodoTree',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: { SystemBars: { insetsHandling: 'css', style: 'LIGHT', hidden: false } }
};

export default config;
