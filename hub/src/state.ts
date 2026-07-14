import type { WebSocket } from 'ws';
import type { HubToAgent, HubToApp, MachineInfo, MachineState, SessionInfo } from './types.js';
import * as db from './db.js';

interface Machine {
  info: MachineInfo;
  online: boolean;
  lastSeen: number;
  sessions: Map<string, SessionInfo>;
  ws: WebSocket | null;
}

const machines = new Map<string, Machine>();
const apps = new Set<WebSocket>();
/** globalId -> app sockets suscritas a la salida de esa sesión */
const subs = new Map<string, Set<WebSocket>>();

export function gid(machineId: string, sessionId: string): string {
  return `${machineId}/${sessionId}`;
}

function splitGid(globalId: string): [string, string] {
  const i = globalId.indexOf('/');
  return [globalId.slice(0, i), globalId.slice(i + 1)];
}

function send(ws: WebSocket | null, msg: HubToAgent | HubToApp): void {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function loadPersisted(): void {
  for (const m of db.listMachines()) {
    machines.set(m.info.id, {
      info: m.info,
      online: false,
      lastSeen: m.lastSeen,
      sessions: new Map(),
      ws: null,
    });
  }
}

// ---- agentes ----

export function agentConnected(info: MachineInfo, ws: WebSocket): void {
  const prev = machines.get(info.id);
  if (prev?.ws && prev.ws !== ws) prev.ws.close();
  machines.set(info.id, {
    info,
    online: true,
    lastSeen: Date.now(),
    sessions: prev?.sessions ?? new Map(),
    ws,
  });
  db.upsertMachine(info, Date.now());
  // Reengancha las suscripciones activas de las apps tras una reconexión del agente.
  for (const [g, set] of subs) {
    if (set.size === 0) continue;
    const [mid, sid] = splitGid(g);
    if (mid === info.id) send(ws, { type: 'subscribe', sessionId: sid });
  }
  broadcast();
}

export function agentDisconnected(machineId: string, ws: WebSocket): void {
  const m = machines.get(machineId);
  if (!m || m.ws !== ws) return;
  m.online = false;
  m.ws = null;
  m.lastSeen = Date.now();
  db.touchMachine(machineId, m.lastSeen);
  broadcast();
}

/** Elimina una máquina offline del panel y de la base de datos. */
export function forgetMachine(machineId: string): boolean {
  const m = machines.get(machineId);
  if (!m || m.online) return false;
  machines.delete(machineId);
  db.deleteMachine(machineId);
  broadcast();
  return true;
}

export function touch(machineId: string): void {
  const m = machines.get(machineId);
  if (m) m.lastSeen = Date.now();
}

export function updateSessions(machineId: string, sessions: SessionInfo[]): void {
  const m = machines.get(machineId);
  if (!m) return;
  m.sessions = new Map(sessions.map((s) => [s.id, s]));
  broadcast();
}

export function onOutput(machineId: string, sessionId: string, data: string, full: boolean): void {
  const g = gid(machineId, sessionId);
  const set = subs.get(g);
  if (!set) return;
  const msg = JSON.stringify({ type: 'output', sessionId: g, data, full } satisfies HubToApp);
  for (const app of set) if (app.readyState === app.OPEN) app.send(msg);
}

export function onEvent(
  machineId: string,
  sessionId: string | undefined,
  cwd: string | undefined,
  event: { kind: string; ts: number; detail?: string },
): void {
  db.recordEvent(machineId, sessionId ?? '', cwd ?? '', event.kind, event.ts, event.detail ?? '');
}

// ---- apps ----

export function appConnected(ws: WebSocket): void {
  apps.add(ws);
  send(ws, { type: 'state', machines: snapshot() });
}

export function appDisconnected(ws: WebSocket): void {
  apps.delete(ws);
  for (const g of [...subs.keys()]) removeSub(g, ws);
}

export function appSubscribe(ws: WebSocket, globalId: string): void {
  let set = subs.get(globalId);
  if (!set) {
    set = new Set();
    subs.set(globalId, set);
  }
  const wasEmpty = set.size === 0;
  set.add(ws);
  if (wasEmpty) {
    const [mid, sid] = splitGid(globalId);
    send(machines.get(mid)?.ws ?? null, { type: 'subscribe', sessionId: sid });
  }
}

export function appUnsubscribe(ws: WebSocket, globalId: string): void {
  removeSub(globalId, ws);
}

function removeSub(globalId: string, ws: WebSocket): void {
  const set = subs.get(globalId);
  if (!set || !set.delete(ws)) return;
  if (set.size === 0) {
    subs.delete(globalId);
    const [mid, sid] = splitGid(globalId);
    send(machines.get(mid)?.ws ?? null, { type: 'unsubscribe', sessionId: sid });
  }
}

// ---- snapshot y difusión ----

export function snapshot(): MachineState[] {
  return [...machines.values()]
    .map((m) => ({
      info: m.info,
      online: m.online,
      lastSeen: m.lastSeen,
      sessions: [...m.sessions.values()].map((s) => ({ ...s, globalId: gid(m.info.id, s.id) })),
    }))
    .sort((a, b) => a.info.name.localeCompare(b.info.name));
}

let broadcastPending = false;

export function broadcast(): void {
  if (broadcastPending) return;
  broadcastPending = true;
  setTimeout(() => {
    broadcastPending = false;
    const msg = JSON.stringify({ type: 'state', machines: snapshot() } satisfies HubToApp);
    for (const app of apps) if (app.readyState === app.OPEN) app.send(msg);
  }, 50);
}
