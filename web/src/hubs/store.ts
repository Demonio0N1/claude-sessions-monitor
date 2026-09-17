import { useSyncExternalStore } from 'react';
import type { HubToApp, MachineState } from '../types';
import { HubClient, normalizeHubUrl, tokenFromLink, type ConnStatus } from './HubClient';
import { initNativeBridge, isNative } from './native';

/** origin: la página que sirve la PWA (nunca se quita);
 *  user: agregado a mano o por deep link; discovery: encontrado vía /api/hubs. */
export type HubSource = 'origin' | 'user' | 'discovery';

export interface KnownHub {
  url: string;
  name: string;
  source: HubSource;
  token?: string;
}

export interface HubStatus extends KnownHub {
  status: ConnStatus;
  machines: number;
}

export interface HubsSnapshot {
  ready: boolean;
  machines: MachineState[];
  status: ConnStatus;
  hubs: HubStatus[];
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  data?: unknown;
}

const STORAGE_KEY = 'csm-hubs';
const DISCOVERY_EVERY_MS = 60_000;
const DISCOVERY_DROP_AFTER = 3;

function machineIdOf(globalId: string): string {
  return globalId.slice(0, globalId.indexOf('/'));
}

function newRequestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Un panel, varios hubs: mantiene una conexión por hub conocido (cada uno con su
 * token), fusiona sus `state` (cada máquina una sola vez, prefiriendo el hub
 * donde está online), enruta acciones y suscripciones de terminal al hub dueño
 * de cada máquina y descubre otros hubs de la tailnet preguntándole a cada hub
 * (`/api/hubs`, que trae también el token de los hubs que conoce).
 */
class HubStore {
  private clients = new Map<string, HubClient>();
  private known = new Map<string, KnownHub>();
  /** URL alternativa (p. ej. `self` que devuelve un hub) -> URL con la que ya conectamos */
  private aliases = new Map<string, string>();
  private missingRounds = new Map<string, number>();
  private owner = new Map<string, HubClient>();
  /** sesiones cuya salida quiere ver la UI y en qué hub están suscritas ahora */
  private wanted = new Set<string>();
  private subscribedAt = new Map<string, HubClient>();
  private msgListeners = new Set<(msg: HubToApp) => void>();
  private storeListeners = new Set<() => void>();
  private snapshot: HubsSnapshot = { ready: false, machines: [], status: 'closed', hubs: [] };
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private discovering: Promise<void> | null = null;
  private started = false;

  // ---- ciclo de vida ----

  start(): void {
    if (this.started) return;
    this.started = true;
    const persisted = this.loadPersisted();
    if (isNative()) {
      for (const k of persisted) this.addHub(k.url, k.source, k.name, k.token);
    } else {
      // La PWA: el hub que sirve la página. El token llega una vez en el enlace
      // (#t=… / ?t=…) y queda guardado; se limpia de la barra de direcciones.
      const origin = normalizeHubUrl(location.origin) ?? location.origin;
      let token = tokenFromLink(location.hash) ?? tokenFromLink(location.search);
      if (token) history.replaceState(null, '', location.pathname);
      else token = persisted.find((k) => k.url === origin)?.token;
      this.addHub(origin, 'origin', undefined, token);
      for (const k of persisted) if (k.source === 'user') this.addHub(k.url, k.source, k.name, k.token);
    }
    this.discoveryTimer = setInterval(() => void this.discoverNow(), DISCOVERY_EVERY_MS);
    // Al volver a la app (o recuperar red), reconecta al instante en vez de esperar
    // el backoff: en el teléfono la conexión muere cada vez que se va a segundo plano.
    const wake = () => {
      if (document.visibilityState === 'visible') this.reconnectAll();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    void initNativeBridge({
      onHub: ({ url, token }) => this.addHub(url, 'user', undefined, token),
      onActive: () => this.reconnectAll(),
    });
    this.recompute();
  }

  private reconnectAll(): void {
    for (const c of this.clients.values()) if (c.status === 'closed') c.connect();
    void this.discoverNow();
  }

  // ---- React ----

  subscribeStore = (l: () => void): (() => void) => {
    this.storeListeners.add(l);
    return () => this.storeListeners.delete(l);
  };

  getSnapshot = (): HubsSnapshot => this.snapshot;

  // ---- hubs conocidos ----

  addHub(rawUrl: string, source: HubSource, name?: string, token?: string): boolean {
    const url = normalizeHubUrl(rawUrl);
    if (!url) return false;
    const canonical = this.aliases.get(url) ?? url;
    const existing = this.known.get(canonical);
    if (existing) {
      // un hub descubierto que el usuario agrega a mano pasa a ser permanente
      if (source === 'user' && existing.source === 'discovery') existing.source = 'user';
      if (name && !existing.name) existing.name = name;
      if (token && token !== existing.token) {
        existing.token = token;
        this.clients.get(canonical)?.setToken(token);
      }
      this.persist();
      this.recompute();
      return true;
    }
    this.known.set(canonical, { url: canonical, name: name ?? '', source, token });
    const client = new HubClient(canonical, name || undefined, token);
    this.clients.set(canonical, client);
    client.onMessage((msg) => this.dispatch(client, msg));
    client.onStatus((s) => {
      this.recompute();
      if (s === 'open') void this.discoverNow();
    });
    client.connect();
    this.persist();
    this.recompute();
    return true;
  }

  setToken(url: string, token: string): void {
    const k = this.known.get(url);
    if (!k) return;
    k.token = token;
    this.clients.get(url)?.setToken(token);
    this.persist();
    this.recompute();
  }

  tokenFor(url: string): string | undefined {
    const norm = normalizeHubUrl(url);
    return norm ? this.known.get(this.aliases.get(norm) ?? norm)?.token : undefined;
  }

  removeHub(url: string): void {
    const k = this.known.get(url);
    if (!k || k.source === 'origin') return;
    this.clients.get(url)?.dispose();
    this.clients.delete(url);
    this.known.delete(url);
    this.missingRounds.delete(url);
    for (const [alias, target] of this.aliases) if (target === url) this.aliases.delete(alias);
    for (const [gid, hub] of this.subscribedAt) if (hub.url === url) this.subscribedAt.delete(gid);
    this.persist();
    this.recompute();
  }

  /** Pregunta a cada hub conectado qué otros paneles ve en la tailnet. */
  discoverNow(): Promise<void> {
    if (this.discovering) return this.discovering;
    this.discovering = this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  private async runDiscovery(): Promise<void> {
    const open = [...this.clients.values()].filter((c) => c.status === 'open');
    if (open.length === 0) return;
    const seen = new Set<string>();
    await Promise.allSettled(
      open.map(async (c) => {
        const r = await c.fetch('/api/hubs', { signal: AbortSignal.timeout(4000) });
        const j = (await r.json()) as { hubs?: { name?: string; url: string; self?: boolean; token?: string }[] };
        for (const h of j.hubs ?? []) {
          const url = normalizeHubUrl(h.url);
          if (!url) continue;
          if (h.self) {
            // el hub se ve a sí mismo por su IP de tailscale; puede que nosotros lo
            // tengamos por otra URL (localhost, DNS, proxy dev): misma conexión
            if (url !== c.url) this.aliases.set(url, c.url);
            if (h.name && !this.known.get(c.url)?.name) this.known.get(c.url)!.name = h.name;
            seen.add(c.url);
            continue;
          }
          const canonical = this.aliases.get(url) ?? url;
          seen.add(canonical);
          this.addHub(canonical, 'discovery', h.name, h.token);
        }
      }),
    );
    // un hub descubierto que ya no aparece ni conecta se olvida tras varias rondas
    for (const [url, k] of this.known) {
      if (k.source !== 'discovery') continue;
      if (seen.has(url) || this.clients.get(url)?.status === 'open') {
        this.missingRounds.delete(url);
        continue;
      }
      const n = (this.missingRounds.get(url) ?? 0) + 1;
      this.missingRounds.set(url, n);
      if (n >= DISCOVERY_DROP_AFTER) this.removeHub(url);
    }
    this.persist();
    this.recompute();
  }

  private loadPersisted(): KnownHub[] {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Partial<KnownHub>[];
      return raw.filter(
        (k): k is KnownHub =>
          typeof k.url === 'string' && (k.source === 'user' || k.source === 'discovery' || k.source === 'origin'),
      );
    } catch {
      return [];
    }
  }

  private persist(): void {
    // Se guardan los tokens (localStorage es privado por origen/app). En el
    // navegador lo descubierto no se persiste: se vuelve a encontrar solo.
    const keep = [...this.known.values()].filter(
      (k) => k.source === 'user' || k.source === 'origin' || (k.source === 'discovery' && isNative()),
    );
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
    } catch {
      /* almacenamiento no disponible */
    }
  }

  // ---- enrutado ----

  hubFor(machineId: string): HubClient | undefined {
    return this.owner.get(machineId);
  }

  hubForSession(globalId: string): HubClient | undefined {
    return this.hubFor(machineIdOf(globalId));
  }

  /** Cliente para peticiones HTTP sobre una máquina (eventos, olvidar…). */
  clientFor(machineId: string): HubClient | undefined {
    return this.owner.get(machineId) ?? [...this.clients.values()].find((c) => c.status === 'open');
  }

  // ---- salida de terminal ----

  onMessage(l: (msg: HubToApp) => void): () => void {
    this.msgListeners.add(l);
    return () => this.msgListeners.delete(l);
  }

  subscribe(globalId: string): void {
    this.wanted.add(globalId);
    this.syncSubscriptions();
  }

  unsubscribe(globalId: string): void {
    this.wanted.delete(globalId);
    this.subscribedAt.get(globalId)?.unsubscribe(globalId);
    this.subscribedAt.delete(globalId);
  }

  /** Cada sesión se sigue en exactamente un hub (el dueño); si cambia, se mueve. */
  private syncSubscriptions(): void {
    for (const gid of this.wanted) {
      const target = this.owner.get(machineIdOf(gid));
      const current = this.subscribedAt.get(gid);
      if (!target || target === current) continue;
      current?.unsubscribe(gid);
      target.subscribe(gid);
      this.subscribedAt.set(gid, target);
    }
  }

  private dispatch(from: HubClient, msg: HubToApp): void {
    if (msg.type === 'state') {
      this.recompute();
      return;
    }
    // frames de terminal solo del hub al que estamos suscritos (nunca duplicados)
    if (msg.type === 'output' && this.subscribedAt.get(msg.sessionId) !== from) return;
    for (const l of this.msgListeners) l(msg);
  }

  // ---- acciones ----

  request(hub: HubClient, msg: Record<string, unknown>, timeoutMs: number): Promise<ActionResult> {
    if (hub.status !== 'open') return Promise.resolve({ ok: false, message: `sin conexión con ${hub.name}` });
    const requestId = newRequestId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve({ ok: false, message: 'sin respuesta del hub (timeout)' });
      }, timeoutMs);
      const off = hub.onMessage((m) => {
        if (m.type === 'action_result' && m.requestId === requestId) {
          clearTimeout(timer);
          off();
          resolve({ ok: m.ok, message: m.message, data: m.data });
        }
      });
      hub.send({ ...msg, requestId });
    });
  }

  /** Borra una máquina offline de todos los hubs que la recuerdan. */
  async forgetMachine(machineId: string): Promise<void> {
    const path = `/api/machines/${encodeURIComponent(machineId)}`;
    await Promise.allSettled(
      [...this.clients.values()]
        .filter((c) => c.machines.some((m) => m.info.id === machineId))
        .map((c) => c.fetch(path, { method: 'DELETE' })),
    );
  }

  // ---- vista fusionada ----

  private recompute(): void {
    const best = new Map<string, { m: MachineState; hub: HubClient; rank: number }>();
    for (const hub of this.clients.values()) {
      for (const raw of hub.machines) {
        const online = raw.online && hub.status === 'open';
        const m = online === raw.online ? raw : { ...raw, online };
        const rank = (online ? 1e15 : 0) + m.lastSeen;
        const prev = best.get(m.info.id);
        if (!prev || rank > prev.rank) best.set(m.info.id, { m, hub, rank });
      }
    }
    this.owner = new Map([...best].map(([id, b]) => [id, b.hub]));
    const machines = [...best.values()].map((b) => b.m).sort((a, b) => a.info.name.localeCompare(b.info.name));

    const statuses = [...this.clients.values()].map((c) => c.status);
    const status: ConnStatus = statuses.includes('open')
      ? 'open'
      : statuses.includes('connecting')
        ? 'connecting'
        : statuses.includes('unauthorized')
          ? 'unauthorized'
          : 'closed';
    const hubs: HubStatus[] = [...this.known.values()].map((k) => {
      const c = this.clients.get(k.url);
      return { ...k, name: k.name || c?.name || k.url, status: c?.status ?? 'closed', machines: c?.machines.length ?? 0 };
    });

    this.snapshot = { ready: this.started, machines, status, hubs };
    this.syncSubscriptions();
    for (const l of this.storeListeners) l();
  }
}

export const hubs = new HubStore();

export function useHubs(): HubsSnapshot {
  return useSyncExternalStore(hubs.subscribeStore, hubs.getSnapshot);
}
