import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORT, TOKEN } from './config.js';

export interface HubEntry {
  name: string;
  url: string;
  self: boolean;
  /** token de ese hub, si este hub lo conoce (propio, o relayado por un agente) */
  token?: string;
}

interface TsNode {
  HostName?: string;
  TailscaleIPs?: string[];
  OS?: string;
  Online?: boolean;
  UserID?: number;
}

interface TsStatus {
  Self?: TsNode;
  Peer?: Record<string, TsNode>;
}

type ReportedHub = string | { url: string; token?: string };

// ---- fuente 1: los agentes ----
// Cada agente manda en su hello los hubs a los que reporta (URL + token). Es la
// fuente que funciona en cualquier máquina sin depender de Tailscale ni de
// permisos: si un agente reporta a este hub y a otro, este hub conoce al otro y
// puede darle a la app el token para entrar ahí sin volver a emparejar.

/** machineId -> hubs reportados por ese agente (host loopback ya reescrito) */
const agentHubs = new Map<string, { url: string; token?: string }[]>();
/** url -> token conocido de ese hub */
const hubTokens = new Map<string, string>();

function stripMapped(ip: string | undefined): string {
  return (ip ?? '').replace(/^::ffff:/i, '');
}

function isLoopbackHost(h: string): boolean {
  return h === '127.0.0.1' || h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '[::1]';
}

export function reportHubs(machineId: string, reported: ReportedHub[], remoteIp: string | undefined): void {
  const agentIp = stripMapped(remoteIp);
  const out: { url: string; token?: string }[] = [];
  for (const r of reported) {
    const raw = typeof r === 'string' ? r : r?.url;
    const token = typeof r === 'string' ? undefined : r?.token;
    if (typeof raw !== 'string') continue;
    try {
      const u = new URL(raw);
      if (isLoopbackHost(u.hostname)) {
        // "127.0.0.1" visto desde el agente es SU máquina: si el agente es
        // remoto, ese hub vive en la IP desde la que se conecta; si es local,
        // es este mismo hub y no aporta nada.
        if (!agentIp || isLoopbackHost(agentIp)) continue;
        u.hostname = agentIp;
      }
      const url = `${u.protocol}//${u.host}`.toLowerCase();
      out.push({ url, token });
      if (token) hubTokens.set(url, token);
    } catch {
      /* URL inválida: se ignora */
    }
  }
  agentHubs.set(machineId, out);
  cache = null;
}

// ---- fuente 2: Tailscale (si está disponible desde el proceso del hub) ----
// La app de Tailscale en macOS no ofrece un CLI fiable fuera de una sesión
// interactiva y su API local exige leer un group container protegido por TCC,
// así que aquí puede no haber nada; en Linux el CLI funciona.

const MAC_PROOF_DIRS = [
  path.join(os.homedir(), 'Library', 'Group Containers', 'W5364U7YZB.group.io.tailscale.ipn.macos'),
  '/Library/Tailscale',
];

const TS_CLI_CANDIDATES = [
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

function macLocalApi(): { port: number; token: string } | null {
  if (process.platform !== 'darwin') return null;
  for (const dir of MAC_PROOF_DIRS) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      const m = /^sameuserproof-(\d+)-([0-9a-f]+)$/i.exec(n);
      if (m) return { port: Number(m[1]), token: m[2] };
    }
  }
  return null;
}

async function tsStatusLocalApi(api: { port: number; token: string }): Promise<TsStatus | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${api.port}/localapi/v0/status`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`:${api.token}`).toString('base64') },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    return (await r.json()) as TsStatus;
  } catch {
    return null;
  }
}

let tsCli: string | undefined;

function tsStatusCli(): Promise<TsStatus | null> {
  if (tsCli === undefined) tsCli = TS_CLI_CANDIDATES.find((p) => fs.existsSync(p)) ?? 'tailscale';
  return new Promise((resolve) => {
    execFile(tsCli!, ['status', '--json'], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout) as TsStatus);
      } catch {
        resolve(null);
      }
    });
  });
}

async function tsStatus(): Promise<TsStatus | null> {
  const api = macLocalApi();
  if (api) {
    const s = await tsStatusLocalApi(api);
    if (s) return s;
  }
  return tsStatusCli();
}

// ---- identidad propia ----

function isTailscaleIPv4(ip: string): boolean {
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

function ipv4(n: TsNode | undefined): string | undefined {
  return n?.TailscaleIPs?.find(isTailscaleIPv4);
}

/** IPs de esta máquina (para no listarse a sí misma como "otro hub"). */
function ownHosts(): Set<string> {
  const s = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1']);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) s.add(i.address);
  return s;
}

function ownTailscaleIp(): string | undefined {
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list ?? []) if (i.family === 'IPv4' && isTailscaleIPv4(i.address)) return i.address;
  return undefined;
}

// ---- sondeo ----

/** ¿Hay un hub de csm en esa URL? (/api/ping es público y devuelve su nombre) */
async function ping(url: string): Promise<{ name?: string } | null> {
  try {
    const r = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(1000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { csm?: boolean; name?: string };
    return j?.csm === true ? { name: j.name } : null;
  } catch {
    return null;
  }
}

let cache: { at: number; hubs: HubEntry[] } | null = null;
let inflight: Promise<HubEntry[]> | null = null;

/**
 * Paneles activos: este hub primero, y después todo candidato (pares de
 * Tailscale del mismo usuario + hubs reportados por los agentes) que responda
 * como hub. Incluye el token de cada uno cuando se conoce. Nunca lanza: sin
 * fuentes devuelve solo este hub.
 */
export function discoverHubs(selfFallbackUrl: string): Promise<HubEntry[]> {
  if (cache && Date.now() - cache.at < 30_000) return Promise.resolve(cache.hubs);
  if (inflight) return inflight;
  inflight = (async () => {
    const status = await tsStatus();
    const self = status?.Self;
    const selfIp = ipv4(self) ?? ownTailscaleIp();
    const selfUrl = selfIp ? `http://${selfIp}:${PORT}` : selfFallbackUrl;
    const selfName = self?.HostName ?? os.hostname().replace(/\.local$/, '');
    const hubs: HubEntry[] = [{ name: selfName, url: selfUrl, self: true, token: TOKEN }];

    const names = new Map<string, string>();
    const candidates = new Set<string>();
    for (const p of Object.values(status?.Peer ?? {})) {
      const ip = ipv4(p);
      if (!p.Online || !ip || (p.OS !== 'macOS' && p.OS !== 'linux')) continue;
      if (self?.UserID !== undefined && p.UserID !== self.UserID) continue;
      const url = `http://${ip}:${PORT}`;
      candidates.add(url);
      if (p.HostName) names.set(url, p.HostName);
    }
    const mine = ownHosts();
    for (const list of agentHubs.values()) {
      for (const { url } of list) {
        try {
          if (mine.has(new URL(url).hostname)) continue;
        } catch {
          continue;
        }
        candidates.add(url);
      }
    }
    candidates.delete(selfUrl);

    const probed = await Promise.allSettled(
      [...candidates].map(async (url) => {
        const p = await ping(url);
        return p ? { name: p.name ?? names.get(url) ?? '', url, self: false, token: hubTokens.get(url) } : null;
      }),
    );
    for (const r of probed) if (r.status === 'fulfilled' && r.value) hubs.push(r.value);
    cache = { at: Date.now(), hubs };
    return hubs;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
