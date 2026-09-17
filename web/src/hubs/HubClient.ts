import type { HubToApp, MachineState } from '../types';

/** unauthorized: el hub rechazó el token (o no tenemos ninguno); no se reintenta hasta cambiarlo. */
export type ConnStatus = 'connecting' | 'open' | 'closed' | 'unauthorized';
type Listener = (msg: HubToApp) => void;

/** Normaliza lo que escribe el usuario o devuelve /api/hubs a `http://host:puerto`. */
export function normalizeHubUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname) return null;
    // "100.1.2.3" sin puerto → el puerto por defecto del hub
    if (!/^(?:https?:\/\/)?[^/]+:\d+/i.test(s) && !u.port) u.port = '4000';
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Token embebido en un enlace de acceso (`…/#t=abc`, `?t=abc`, `&token=abc`). */
export function tokenFromLink(raw: string): string | undefined {
  const m = /[#?&](?:t|token)=([0-9A-Za-z_-]+)/.exec(raw);
  return m?.[1];
}

/** ¿Hay un hub de csm en esa URL? (/api/ping es público) → su nombre. */
export async function pingHub(url: string): Promise<{ name: string } | null> {
  try {
    const r = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { csm?: boolean; name?: string };
    return j?.csm === true ? { name: j.name ?? '' } : null;
  } catch {
    return null;
  }
}

/** ¿El token abre ese hub? */
export async function checkToken(url: string, token: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/state`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Conexión a UN hub: WebSocket /ws/app (con el token del hub) con reconexión
 * (backoff 1 s → 15 s), replay de suscripciones al reabrir, y el último `state`
 * recibido para que el store fusione varias conexiones en un solo panel.
 */
export class HubClient {
  readonly url: string;
  name: string;
  token: string | undefined;
  machines: MachineState[] = [];
  lastStateAt = 0;
  status: ConnStatus = 'closed';

  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: ConnStatus) => void>();
  private subscribed = new Set<string>();
  private backoff = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(url: string, name?: string, token?: string) {
    this.url = url;
    this.name = name ?? new URL(url).host;
    this.token = token;
  }

  setToken(token: string | undefined): void {
    if (token === this.token) return;
    this.token = token;
    this.ws?.close();
    this.ws = null;
    this.connect();
  }

  connect(): void {
    if (this.disposed) return;
    if (!this.token) {
      this.setStatus('unauthorized');
      return;
    }
    // idempotente: si ya hay una conexión viva o en curso, no abre otra
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setStatus('connecting');
    const ws = new WebSocket(`${this.url.replace(/^http/i, 'ws')}/ws/app?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      this.setStatus('open');
      for (const id of this.subscribed) this.send({ type: 'subscribe', sessionId: id });
    };
    ws.onmessage = (ev) => {
      let msg: HubToApp;
      try {
        msg = JSON.parse(ev.data) as HubToApp;
      } catch {
        return;
      }
      if (msg.type === 'state') {
        this.machines = msg.machines;
        this.lastStateAt = Date.now();
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = (ev) => {
      if (this.disposed) {
        this.setStatus('closed');
        return;
      }
      if (ev.code === 4401) {
        // token rechazado: esperar a que el usuario lo corrija, sin martillar al hub
        this.setStatus('unauthorized');
        return;
      }
      this.setStatus('closed');
      this.retryTimer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 1.7, 15_000);
    };
    ws.onerror = () => ws.close();
  }

  /** Cierra definitivamente (al quitar el hub de la lista). */
  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
    this.machines = [];
    this.setStatus('closed');
  }

  private setStatus(s: ConnStatus): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    return fetch(this.url + path, { ...init, headers });
  }

  subscribe(sessionId: string): void {
    this.subscribed.add(sessionId);
    this.send({ type: 'subscribe', sessionId });
  }

  unsubscribe(sessionId: string): void {
    this.subscribed.delete(sessionId);
    this.send({ type: 'unsubscribe', sessionId });
  }

  onMessage(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: (s: ConnStatus) => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }
}
