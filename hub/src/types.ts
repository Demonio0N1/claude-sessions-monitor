export type SessionStatus =
  | 'active'
  | 'waiting_input'
  | 'waiting_choice'
  | 'idle'
  | 'paused'
  | 'error'
  | 'ended';

export type ActionKind = 'send_prompt' | 'send_key' | 'pause' | 'resume' | 'kill' | 'force_kill';

/** Acciones dirigidas a la máquina (no a una sesión): explorador de archivos,
 *  sesiones/terminales nuevos, captura de pantalla, subir/bajar archivos. */
export type MachineActionKind =
  | 'list_dir'
  | 'new_session'
  | 'new_terminal'
  | 'screenshot'
  | 'put_file'
  | 'get_file'
  | 'delete_path'
  | 'rename_path'
  | 'mkdir';

export interface DirEntry {
  name: string;
  path: string;
  dir?: boolean; // ausente en agentes viejos (solo devolvían carpetas)
  size?: number; // bytes, solo archivos
  mtime?: number; // epoch ms
}

/** Respuesta de list_dir. */
export interface DirListing {
  path: string;
  parent?: string;
  home: string;
  entries: DirEntry[];
}

export interface SessionInfo {
  /** Id local a la máquina, ej. "tmux:%3" o "pid:1234" */
  id: string;
  kind: 'tmux' | 'process';
  agent?: string;
  tmuxSession?: string;
  pid: number;
  cwd: string;
  project: string;
  startedAt: number; // epoch ms
  status: SessionStatus;
  lastEvent?: string;
  lastEventAt?: number;
}

export interface MachineInfo {
  id: string;
  name: string;
  os: string;
  arch: string;
  version: string;
}

export interface MachineState {
  info: MachineInfo;
  online: boolean;
  lastSeen: number;
  sessions: (SessionInfo & { globalId: string })[];
}

export interface HookEvent {
  kind: string;
  ts: number;
  detail?: string;
}

// agente -> hub
export type AgentMsg =
  | { type: 'hello'; token: string; machine: MachineInfo; hubs?: string[] }
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'output'; sessionId: string; data: string; full: boolean }
  | { type: 'event'; sessionId?: string; cwd?: string; event: HookEvent }
  | { type: 'action_result'; requestId: string; ok: boolean; message?: string; data?: unknown }
  | { type: 'pong' };

// hub -> agente
export type HubToAgent =
  | { type: 'hello_ok' }
  | { type: 'error'; message: string }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'action'; requestId: string; sessionId: string; action: ActionKind; text?: string }
  | {
      type: 'machine_action';
      requestId: string;
      action: MachineActionKind;
      path?: string;
      fresh?: boolean;
      name?: string; // put_file: nombre del archivo
      data?: string; // put_file: contenido en base64 (data URI o base64 pelado)
      agent?: string; // new_session: qué CLI lanzar (default claude)
      gateway?: boolean; // new_session: enrutar por OmniRoute (localhost:20128)
    }
  | { type: 'ping' };

// hub -> app
export type HubToApp =
  | { type: 'state'; machines: MachineState[] }
  | { type: 'output'; sessionId: string; data: string; full: boolean }
  | { type: 'action_result'; requestId: string; ok: boolean; message?: string; data?: unknown };

// app -> hub
export type AppMsg =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'action'; requestId: string; sessionId: string; action: ActionKind; text?: string }
  | {
      type: 'machine_action';
      requestId: string;
      machineId: string;
      action: MachineActionKind;
      path?: string;
      fresh?: boolean;
      name?: string;
      data?: string;
      agent?: string;
      gateway?: boolean;
    };
