import type { SessionStatus } from '../types';

const STYLES: Record<SessionStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  active: { label: 'Activa', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400', pulse: true },
  waiting_input: { label: 'Esperando input', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40', dot: 'bg-amber-400', pulse: true },
  idle: { label: 'Inactiva', cls: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40', dot: 'bg-zinc-400' },
  error: { label: 'Error', cls: 'bg-red-500/15 text-red-300 border-red-500/40', dot: 'bg-red-400', pulse: true },
  ended: { label: 'Terminada', cls: 'bg-zinc-600/15 text-zinc-400 border-zinc-600/40', dot: 'bg-zinc-500' },
};

export default function StatusBadge({ status, offline }: { status: SessionStatus; offline?: boolean }) {
  if (offline) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-600/40 bg-zinc-600/15 px-2.5 py-1 text-xs font-medium text-zinc-400">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
        Offline
      </span>
    );
  }
  const s = STYLES[status] ?? STYLES.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? 'pulse-dot' : ''}`} />
      {s.label}
    </span>
  );
}
