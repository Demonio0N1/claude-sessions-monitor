import { useEffect, useState } from 'react';
import type { EventRow, MachineState, SessionInfo } from '../types';
import { eventLabel, timeAgo, uptime } from '../format';
import StatusBadge from './StatusBadge';
import Terminal from './Terminal';

export default function SessionDetail({
  session,
  machine,
}: {
  session: SessionInfo;
  machine: MachineState;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tab, setTab] = useState<'terminal' | 'info'>('terminal');
  const offline = !machine.online;

  useEffect(() => {
    const url = `/api/events?machine=${encodeURIComponent(machine.info.id)}&session=${encodeURIComponent(session.id)}&limit=50`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]));
  }, [machine.info.id, session.id, session.lastEventAt]);

  const canStream = session.kind === 'tmux' && !offline;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          onClick={() => (location.hash = '#/')}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm active:scale-95"
          aria-label="Volver"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">{session.project}</h1>
          <p className="truncate text-xs text-zinc-400">
            {machine.info.name}
            {offline && ` · offline, visto ${timeAgo(machine.lastSeen)}`}
          </p>
        </div>
        <StatusBadge status={session.status} offline={offline} />
      </header>

      <nav className="flex gap-1 border-b border-zinc-800 px-4 py-2">
        {(['terminal', 'info'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm capitalize ${
              tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-400'
            }`}
          >
            {t === 'terminal' ? 'Terminal' : 'Info y actividad'}
          </button>
        ))}
      </nav>

      {tab === 'terminal' ? (
        <div className="min-h-0 flex-1 bg-[#09090b] p-2">
          {canStream ? (
            <Terminal globalId={session.globalId} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-400">
              {offline ? (
                <p>La máquina está offline; no hay salida en vivo.</p>
              ) : (
                <p>
                  Esta sesión corre fuera de tmux (visibilidad limitada).
                  <br />
                  Lánzala con <code className="text-emerald-300">csm</code> para ver su terminal aquí.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <dl className="mb-6 space-y-2 text-sm">
            {[
              ['Directorio', session.cwd],
              ['PID', String(session.pid)],
              ['Tipo', session.kind === 'tmux' ? `tmux (${session.tmuxSession})` : 'proceso suelto'],
              ['Tiempo activo', uptime(session.startedAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-28 shrink-0 text-zinc-500">{k}</dt>
                <dd className="break-all font-mono text-xs leading-5 text-zinc-200">{v}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mb-2 text-sm font-semibold text-zinc-300">Actividad reciente</h3>
          {events.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Sin eventos registrados aún. Los eventos aparecen cuando los hooks de Claude Code
              reportan actividad.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 font-mono text-xs text-zinc-500">{timeAgo(e.ts)}</span>
                  <span className="text-zinc-200">{eventLabel(e.kind)}</span>
                  {e.detail && <span className="truncate text-xs text-zinc-500">{e.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
