// Agentes que csm sabe lanzar/detectar (ver agent/agents.go — mismos Kind).
export interface AgentOption {
  kind: string;
  label: string;
  icon: string;
}

export const AGENT_OPTIONS: AgentOption[] = [
  { kind: 'claude', label: 'Claude', icon: '✳️' },
  { kind: 'codex', label: 'Codex', icon: '🌀' },
  { kind: 'opencode', label: 'OpenCode', icon: '🧩' },
  { kind: 'cursor-agent', label: 'Cursor', icon: '▲' },
];

export function agentInfo(kind?: string): AgentOption {
  return AGENT_OPTIONS.find((a) => a.kind === kind) ?? AGENT_OPTIONS[0];
}
