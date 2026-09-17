import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.csm.app',
  appName: 'Claude Sessions',
  webDir: 'dist',
  // Origen http://localhost: hablar con los hubs por http:// y ws:// no es
  // contenido mixto (con el https por defecto el WebView lo bloquearía).
  server: { androidScheme: 'http' },
  android: { adjustMarginsForEdgeToEdge: 'auto' },
};

export default config;
