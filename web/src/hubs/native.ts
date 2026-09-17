import { Capacitor } from '@capacitor/core';
import { normalizeHubUrl } from './HubClient';

/** true dentro del APK (WebView de Capacitor); false en el navegador/PWA. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Deep link de "Abrir en la app": `csm://hub?url=<hub>` o `csm://hub/<host:puerto>`. */
export function parseHubDeepLink(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'csm:') return null;
    const q = u.searchParams.get('url');
    if (q) return normalizeHubUrl(q);
    const path = u.pathname.replace(/^\/+/, '');
    return path ? normalizeHubUrl(path) : null;
  } catch {
    return null;
  }
}

/**
 * Engancha los eventos nativos: URL de arranque y deep links (para sumar un hub
 * con un toque desde el navegador) y vuelta a primer plano (reconectar).
 */
export async function initNativeBridge(handlers: {
  onHub: (url: string) => void;
  onActive: () => void;
}): Promise<void> {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch?.url) {
    const hub = parseHubDeepLink(launch.url);
    if (hub) handlers.onHub(hub);
  }
  await App.addListener('appUrlOpen', ({ url }) => {
    const hub = parseHubDeepLink(url);
    if (hub) handlers.onHub(hub);
  });
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) handlers.onActive();
  });
}
