import { useState } from 'react';
import type { MachineState } from '../types';
import { timeAgo } from '../format';
import SessionCard from './SessionCard';
import NewSessionModal from './NewSessionModal';
import ScreenshotModal from './ScreenshotModal';
import FilesModal from './FilesModal';
import { hubs } from '../hubs/store';
import { runMachineAction } from '../actions';
import { toast } from '../toast';

const OS_ICON: Record<string, string> = { darwin: '🍎', linux: '🐧', windows: '🪟' };

export default function MachineGroup({ machine }: { machine: MachineState }) {
  const { info, online, lastSeen, sessions } = machine;
  const [showNew, setShowNew] = useState(false);
  const [showShot, setShowShot] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const btn =
    'flex items-center gap-1.5 rounded-xl border border-zinc-700/80 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-200 transition active:scale-95 hover:border-zinc-500';

  return (
    <section
      className={`card-in rounded-3xl border bg-zinc-900/40 p-4 shadow-xl shadow-black/20 ${
        online ? 'border-zinc-800' : 'border-zinc-800/60 opacity-60'
      }`}
    >
      <div className="mb-1 flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-lg ${
            online
              ? 'border-emerald-500/25 bg-emerald-500/10'
              : 'border-zinc-700 bg-zinc-800/60 grayscale'
          }`}
        >
          {OS_ICON[info.os] ?? '💻'}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-zinc-100">
            <span className="truncate">{info.name}</span>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400 pulse-dot' : 'bg-zinc-600'}`}
            />
          </h2>
          <p className="text-[11px] text-zinc-500">
            {info.os}/{info.arch}
            {online
              ? ` · ${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'}`
              : ` · visto ${timeAgo(lastSeen)}`}
          </p>
        </div>
        {!online && (
          <button
            onClick={() => {
              if (confirm(`¿Olvidar la máquina "${info.name}"? Se borra del panel y su historial.`)) {
                void hubs.forgetMachine(info.id);
              }
            }}
            className={btn}
          >
            ✕ olvidar
          </button>
        )}
      </div>

      {online && info.os === 'darwin' && info.perms?.fullDisk === false && (
        <div className="mb-3 mt-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-100">
          <b>⚠️ Falta un permiso en esta Mac.</b> El agente no tiene <b>Acceso total al disco</b>: navegar
          por sus archivos desde aquí pedirá permiso carpeta por carpeta (y los avisos salen en la Mac).
          Actívalo una vez en Ajustes del Sistema → Privacidad y seguridad → Acceso total al disco → csm-agent.
          {info.perms.signed === false && (
            <> Reinstala el agente con el instalador nuevo para que el permiso se conserve al actualizar.</>
          )}
          <div className="mt-2">
            <button
              onClick={async () => {
                const r = await runMachineAction(info.id, 'open_privacy');
                toast(r.message ?? (r.ok ? 'listo' : 'error'), r.ok ? 'ok' : 'error');
              }}
              className={`${btn} border-amber-500/40 bg-amber-500/10 text-amber-200`}
            >
              Abrir Ajustes en la Mac
            </button>
          </div>
        </div>
      )}

      {online && (
        <div className="mb-3 mt-2 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setShowNew(true)} className={`${btn} border-emerald-700/50 bg-emerald-950/50 text-emerald-300 hover:border-emerald-500/60`}>
            ＋ Nueva sesión
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className={btn}
            title="explorar, subir y gestionar archivos; abrir Claude o un terminal en cualquier carpeta"
          >
            📁 Archivos
          </button>
          <button onClick={() => setShowShot(true)} className={btn} title="captura de pantalla de esta máquina">
            📸 Pantalla
          </button>
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-800 px-4 py-4 text-center text-sm text-zinc-500">
          Sin sesiones de Claude aquí. Lanza una con <code className="text-emerald-300">csm</code>
          {online && (
            <>
              {' '}
              o con <span className="text-emerald-300">＋ Nueva sesión</span>
            </>
          )}
          .
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {sessions.map((s) => (
            <SessionCard key={s.globalId} session={s} offline={!online} />
          ))}
        </div>
      )}
      {showNew && <NewSessionModal machine={machine} onClose={() => setShowNew(false)} />}
      {showShot && <ScreenshotModal machine={machine} onClose={() => setShowShot(false)} />}
      {showUpload && <FilesModal machine={machine} onClose={() => setShowUpload(false)} />}
    </section>
  );
}
