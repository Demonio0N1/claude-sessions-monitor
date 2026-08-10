import type { HubToApp } from './types';

type Listener = (msg: HubToApp) => void;
export type ConnStatus = 'connecting' | 'open' | 'closed';

class WSClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: ConnStatus) => void>();
  private subscribed = new Set<string>();
  private backoff = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  status: ConnStatus = 'connecting';

  connect(): void {
    // idempotente: si ya hay una conexión viva o en curso, no abre otra
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.setStatus('connecting');
    const ws = new WebSocket(`${proto}://${location.host}/ws/app`);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      this.setStatus('open');
      for (const id of this.subscribed) this.raw({ type: 'subscribe', sessionId: id });
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as HubToApp;
        for (const l of this.listeners) l(msg);
      } catch {
        /* ignora mensajes malformados */
      }
    };
    ws.onclose = () => {
      this.setStatus('closed');
      this.retryTimer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 1.7, 15_000);
    };
    ws.onerror = () => ws.close();
  }

  private setStatus(s: ConnStatus): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private raw(msg: unknown): void {
    this.send(msg);
  }

  subscribe(sessionId: string): void {
    this.subscribed.add(sessionId);
    this.raw({ type: 'subscribe', sessionId });
  }

  unsubscribe(sessionId: string): void {
    this.subscribed.delete(sessionId);
    this.raw({ type: 'unsubscribe', sessionId });
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

export const wsClient = new WSClient();
wsClient.connect();

// Al volver a la app (o recuperar red), reconecta al instante en vez de esperar
// el backoff: en el teléfono la conexión muere cada vez que se va a segundo plano.
function reconnectNow() {
  if (document.visibilityState === 'visible' && wsClient.status === 'closed') {
    wsClient.connect();
  }
}
document.addEventListener('visibilitychange', reconnectNow);
window.addEventListener('online', reconnectNow);
window.addEventListener('focus', reconnectNow);
