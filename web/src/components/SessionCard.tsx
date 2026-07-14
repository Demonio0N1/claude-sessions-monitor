import type { SessionInfo } from '../types';
import { eventLabel, timeAgo, uptime } from '../format';
import StatusBadge from './StatusBadge';

export default function SessionCard({ session, offline }: { session: SessionInfo; offline: boolean }) {
  const s = session;
  return (
    <button
      onClick={() => (location.hash = `#/s/${encodeURIComponent(s.globalId)}`)}
      className="block w-full rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 text-left transition active:scale-[0.98] hover:border-zinc-600"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="truncate text-base font-semibold">{s.project || '(sin proyecto)'}</span>
        <StatusBadge status={s.status} offline={offline} />
      </div>
      <p className="mb-3 truncate font-mono text-xs text-zinc-500">{s.cwd}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <span>⏱ {uptime(s.startedAt)}</span>
        {s.kind === 'tmux' ? (
          <span className="text-emerald-400/90">tmux · {s.tmuxSession}</span>
        ) : (
          <span className="text-zinc-500">visibilidad limitada</span>
        )}
        {s.lastEvent && s.lastEventAt && (
          <span className="text-zinc-500">
            {eventLabel(s.lastEvent)} {timeAgo(s.lastEventAt)}
          </span>
        )}
      </div>
    </button>
  );
}
