import type { ActionKind, MachineActionKind } from './types';
import { wsClient } from './ws';

export interface ActionResult {
  ok: boolean;
  message?: string;
  data?: unknown;
}

// crypto.randomUUID() solo existe en contextos seguros (HTTPS/localhost); la app
// se usa por HTTP dentro de la tailnet, así que generamos ids a mano.
function newRequestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Envía una acción de control y espera la respuesta del agente (vía hub). */
export function runAction(sessionId: string, action: ActionKind, text?: string): Promise<ActionResult> {
  const requestId = newRequestId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve({ ok: false, message: 'sin respuesta del hub (timeout)' });
    }, 12_000);
    const off = wsClient.onMessage((msg) => {
      if (msg.type === 'action_result' && msg.requestId === requestId) {
        clearTimeout(timer);
        off();
        resolve({ ok: msg.ok, message: msg.message });
      }
    });
    wsClient.send({ type: 'action', requestId, sessionId, action, text });
  });
}

/** Acción dirigida a una máquina (listar carpetas, crear sesión, subir archivo) y su respuesta. */
export function runMachineAction(
  machineId: string,
  action: MachineActionKind,
  opts: { path?: string; fresh?: boolean; name?: string; data?: string } = {},
): Promise<ActionResult> {
  const requestId = newRequestId();
  // subir un archivo grande por la tailnet puede tardar: margen mayor
  const timeoutMs = action === 'put_file' ? 65_000 : 17_000;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve({ ok: false, message: 'sin respuesta del hub (timeout)' });
    }, timeoutMs);
    const off = wsClient.onMessage((msg) => {
      if (msg.type === 'action_result' && msg.requestId === requestId) {
        clearTimeout(timer);
        off();
        resolve({ ok: msg.ok, message: msg.message, data: msg.data });
      }
    });
    wsClient.send({ type: 'machine_action', requestId, machineId, action, ...opts });
  });
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
