import { Capacitor } from '@capacitor/core';
import { normalizeHubUrl } from './HubClient';

/** true dentro del APK (WebView de Capacitor); false en el navegador/PWA. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export interface HubLink {
  url: string;
  token?: string;
}

/** Deep link de "Abrir en la app": `csm://hub?url=<hub>&token=<token>` o `csm://hub/<host:puerto>`. */
export function parseHubDeepLink(raw: string): HubLink | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'csm:') return null;
    const token = u.searchParams.get('token') ?? undefined;
    const q = u.searchParams.get('url');
    if (q) {
      const url = normalizeHubUrl(q);
      return url ? { url, token } : null;
    }
    const path = u.pathname.replace(/^\/+/, '');
    const url = path ? normalizeHubUrl(path) : null;
    return url ? { url, token } : null;
  } catch {
    return null;
  }
}

/**
 * Engancha los eventos nativos: URL de arranque y deep links (para sumar un hub
 * con un toque desde el navegador) y vuelta a primer plano (reconectar).
 */
export async function initNativeBridge(handlers: {
  onHub: (link: HubLink) => void;
  onActive: () => void;
}): Promise<void> {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch?.url) {
    const link = parseHubDeepLink(launch.url);
    if (link) handlers.onHub(link);
  }
  await App.addListener('appUrlOpen', ({ url }) => {
    const link = parseHubDeepLink(url);
    if (link) handlers.onHub(link);
  });
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) handlers.onActive();
  });
}
