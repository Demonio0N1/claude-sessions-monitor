export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h ${m % 60}m`;
  return `hace ${Math.floor(h / 24)}d`;
}

export function uptime(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const EVENT_LABELS: Record<string, string> = {
  SessionStart: 'Sesión iniciada',
  UserPromptSubmit: 'Prompt enviado',
  PreToolUse: 'Usando herramienta',
  PostToolUse: 'Herramienta terminada',
  Stop: 'Terminó de responder',
  Notification: 'Esperando tu atención',
  SessionEnd: 'Sesión terminada',
};

export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind;
}
