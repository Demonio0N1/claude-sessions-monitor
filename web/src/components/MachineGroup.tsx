import type { MachineState } from '../types';
import { timeAgo } from '../format';
import SessionCard from './SessionCard';

export default function MachineGroup({ machine }: { machine: MachineState }) {
  const { info, online, lastSeen, sessions } = machine;
  return (
    <section className={online ? '' : 'opacity-55'}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">{info.name}</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
          {info.os}/{info.arch}
        </span>
        {!online && (
          <>
            <span className="text-xs text-zinc-500">visto {timeAgo(lastSeen)}</span>
            <button
              onClick={() => {
                if (confirm(`¿Olvidar la máquina "${info.name}"? Se borra del panel y su historial.`)) {
                  fetch(`/api/machines/${encodeURIComponent(info.id)}`, { method: 'DELETE' });
                }
              }}
              className="ml-auto rounded-lg border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 active:scale-95"
            >
              ✕ olvidar
            </button>
          </>
        )}
      </div>
      {sessions.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 px-4 py-3 text-sm text-zinc-500">
          Sin sesiones de Claude. Lanza una con <code className="text-emerald-300">csm</code>.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sessions.map((s) => (
            <SessionCard key={s.globalId} session={s} offline={!online} />
          ))}
        </div>
      )}
    </section>
  );
}
