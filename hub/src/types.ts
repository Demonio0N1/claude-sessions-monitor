export type SessionStatus =
  | 'active'
  | 'waiting_input'
  | 'waiting_choice'
  | 'idle'
  | 'paused'
  | 'error'
  | 'ended';

export type ActionKind = 'send_prompt' | 'send_key' | 'pause' | 'resume' | 'kill' | 'force_kill';

export interface SessionInfo {
  /** Id local a la máquina, ej. "tmux:%3" o "pid:1234" */
  id: string;
  kind: 'tmux' | 'process';
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
  | { type: 'hello'; token: string; machine: MachineInfo }
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'output'; sessionId: string; data: string; full: boolean }
  | { type: 'event'; sessionId?: string; cwd?: string; event: HookEvent }
  | { type: 'action_result'; requestId: string; ok: boolean; message?: string }
  | { type: 'pong' };

// hub -> agente
export type HubToAgent =
  | { type: 'hello_ok' }
  | { type: 'error'; message: string }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'action'; requestId: string; sessionId: string; action: ActionKind; text?: string }
  | { type: 'ping' };

// hub -> app
export type HubToApp =
  | { type: 'state'; machines: MachineState[] }
  | { type: 'output'; sessionId: string; data: string; full: boolean }
  | { type: 'action_result'; requestId: string; ok: boolean; message?: string };

// app -> hub
export type AppMsg =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'action'; requestId: string; sessionId: string; action: ActionKind; text?: string };
