import type { SessionInfo, SessionStatus } from '../types';
import { eventLabel, timeAgo, uptime } from '../format';
import StatusBadge from './StatusBadge';
import { agentInfo } from '../agents';

// barra de acento a la izquierda según el estado (misma paleta que StatusBadge)
const ACCENT: Record<SessionStatus, string> = {
  active: 'border-l-emerald-500/70',
  waiting_input: 'border-l-amber-400/70',
  waiting_choice: 'border-l-orange-400/80',
  idle: 'border-l-zinc-600',
  paused: 'border-l-sky-500/70',
  error: 'border-l-red-500/80',
  ended: 'border-l-zinc-700',
};

export default function SessionCard({ session, offline }: { session: SessionInfo; offline: boolean }) {
  const s = session;
  const home = '~';
  const shownCwd = s.cwd.replace(/^\/(?:Users|home)\/[^/]+/, home);
  return (
    <button
      onClick={() => (location.hash = `#/s/${encodeURIComponent(s.globalId)}`)}
      className={`block w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-l-4 border-zinc-800 bg-zinc-900/70 p-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900 active:scale-[0.98] ${
        offline ? 'border-l-zinc-700' : ACCENT[s.status] ?? 'border-l-zinc-600'
      }`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {s.agent && (
            <span
              className="shrink-0 text-sm"
              title={agentInfo(s.agent).label}
              aria-label={agentInfo(s.agent).label}
            >
              {agentInfo(s.agent).icon}
            </span>
          )}
          <span className="truncate text-base font-semibold">{s.project || '(sin proyecto)'}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <StatusBadge status={s.status} offline={offline} />
          <span className="text-zinc-600">›</span>
        </span>
      </div>
      <p className="mb-2.5 truncate font-mono text-xs text-zinc-500">{shownCwd}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <span>⏱ {uptime(s.startedAt)}</span>
        {s.kind === 'tmux' ? (
          <span className="text-emerald-400/90">⌁ {s.tmuxSession}</span>
        ) : (
          <span className="text-zinc-500" title="Solo pausar/terminar; sin terminal en vivo">
            visibilidad limitada
          </span>
        )}
        {s.lastEvent && s.lastEventAt && (
          <span className="text-zinc-500">
            {eventLabel(s.lastEvent)} {timeAgo(s.lastEventAt)}
          </span>
        )}
      </div>
      {s.kind === 'process' && (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-xs text-zinc-500">
          Migra a csm: cierra Claude ahí y corre{' '}
          <code className="text-emerald-400/80">csm</code> en su directorio (retoma la
          conversación).
        </p>
      )}
    </button>
  );
}
