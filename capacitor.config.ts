import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lucas.todotree',
  appName: 'TodoTree',
  webDir: 'dist',
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: 'auto' }
};

export default config;
