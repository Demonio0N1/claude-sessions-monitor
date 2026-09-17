import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORT } from './config.js';

export interface HubEntry {
  name: string;
  url: string;
  self: boolean;
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

// La app de Tailscale en macOS (App Store o standalone) no ofrece un CLI fiable
// fuera de una sesión interactiva: bajo launchd responde "The Tailscale GUI
// failed to start" con texto no-JSON. Su API local por HTTP sí funciona siempre;
// el puerto y el token van en el nombre de un archivo sameuserproof-<puerto>-<token>.
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

function ipv4(n: TsNode | undefined): string | undefined {
  return n?.TailscaleIPs?.find((ip) => ip.startsWith('100.'));
}

async function isHub(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(1000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { machines?: unknown };
    return Array.isArray(j?.machines);
  } catch {
    return false;
  }
}

let cache: { at: number; hubs: HubEntry[] } | null = null;
let inflight: Promise<HubEntry[]> | null = null;

/**
 * Paneles activos en la tailnet: este hub primero y luego cada peer del MISMO
 * usuario (la tailnet puede estar compartida con nodos ajenos) que esté online,
 * tenga IPv4 y responda como hub en el mismo puerto. Nunca lanza: sin tailscale
 * devuelve solo este hub.
 */
export function discoverHubs(selfFallbackUrl: string): Promise<HubEntry[]> {
  if (cache && Date.now() - cache.at < 30_000) return Promise.resolve(cache.hubs);
  if (inflight) return inflight;
  inflight = (async () => {
    const status = await tsStatus();
    const self = status?.Self;
    const selfIp = ipv4(self);
    const hubs: HubEntry[] = [
      { name: self?.HostName ?? 'este hub', url: selfIp ? `http://${selfIp}:${PORT}` : selfFallbackUrl, self: true },
    ];
    const peers = Object.values(status?.Peer ?? {}).filter(
      (p) =>
        p.Online &&
        ipv4(p) &&
        (p.OS === 'macOS' || p.OS === 'linux') &&
        (self?.UserID === undefined || p.UserID === self.UserID),
    );
    const probed = await Promise.allSettled(
      peers.map(async (p) => {
        const url = `http://${ipv4(p)}:${PORT}`;
        return (await isHub(url)) ? { name: p.HostName ?? url, url, self: false } : null;
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
