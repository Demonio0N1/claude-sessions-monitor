import type { ActionKind, MachineActionKind } from './types';
import { hubs, type ActionResult } from './hubs/store';

export type { ActionResult };

/** Envía una acción de control al hub dueño de la sesión y espera su respuesta. */
export function runAction(sessionId: string, action: ActionKind, text?: string): Promise<ActionResult> {
  const hub = hubs.hubForSession(sessionId);
  if (!hub) return Promise.resolve({ ok: false, message: 'sesión no encontrada (¿terminó?)' });
  return hubs.request(hub, { type: 'action', sessionId, action, text }, 12_000);
}

/** Acción dirigida a una máquina (listar carpetas, crear sesión, subir archivo) y su respuesta. */
export function runMachineAction(
  machineId: string,
  action: MachineActionKind,
  opts: { path?: string; fresh?: boolean; name?: string; data?: string; agent?: string; gateway?: boolean } = {},
): Promise<ActionResult> {
  const hub = hubs.hubFor(machineId);
  if (!hub) return Promise.resolve({ ok: false, message: 'la máquina está offline' });
  // subir/bajar un archivo grande por la tailnet puede tardar: margen mayor
  const timeoutMs = action === 'put_file' || action === 'get_file' ? 65_000 : 17_000;
  return hubs.request(hub, { type: 'machine_action', machineId, action, ...opts }, timeoutMs);
}

// ---- historial local de prompts enviados (por sesión) ----

const HISTORY_MAX = 20;

export function promptHistory(globalId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`csm-prompts:${globalId}`) ?? '[]');
  } catch {
    return [];
  }
}

export function rememberPrompt(globalId: string, text: string): void {
  const list = [text, ...promptHistory(globalId).filter((p) => p !== text)].slice(0, HISTORY_MAX);
  localStorage.setItem(`csm-prompts:${globalId}`, JSON.stringify(list));
}
