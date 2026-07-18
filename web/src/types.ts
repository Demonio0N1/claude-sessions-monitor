export type SessionStatus =
  | 'active'
  | 'waiting_input'
  | 'waiting_choice'
  | 'idle'
  | 'paused'
  | 'error'
  | 'ended';

export type ActionKind = 'send_prompt' | 'send_key' | 'pause' | 'resume' | 'kill' | 'force_kill';

/** Acciones dirigidas a la máquina (no a una sesión): navegar carpetas, crear sesiones, capturar pantalla. */
export type MachineActionKind = 'list_dir' | 'new_session' | 'screenshot';

export interface DirEntry {
  name: string;
  path: string;
}

/** Respuesta de list_dir. */
export interface DirListing {
  path: string;
  parent?: string;
  home: string;
  entries: DirEntry[];
}

export interface SessionInfo {
  id: string;
  globalId: string;
  kind: 'tmux' | 'process';
  tmuxSession?: string;
  pid: number;
  cwd: string;
  project: string;
  startedAt: number;
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
  sessions: SessionInfo[];
}

export type HubToApp =
  | { type: 'state'; machines: MachineState[] }
  | { type: 'output'; sessionId: string; data: string; full: boolean }
  | { type: 'action_result'; requestId: string; ok: boolean; message?: string; data?: unknown };

export interface EventRow {
  kind: string;
  ts: number;
  detail: string;
}
