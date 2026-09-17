import { useEffect, useState } from 'react';
import type { MachineState, SessionInfo } from './types';
import { useHubs } from './hubs/store';
import { isNative } from './hubs/native';
import MachineGroup from './components/MachineGroup';
import SessionDetail from './components/SessionDetail';
import HubsSheet from './components/HubsSheet';
import HubSetup from './components/HubSetup';
import InstallApp from './components/InstallApp';
import { ToastHost } from './toast';

function useHashRoute(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const { ready, machines, status: conn, hubs: hubList } = useHubs();
  const hash = useHashRoute();
  const [showHubs, setShowHubs] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000); // refresca "hace Xm"
    return () => clearInterval(iv);
  }, []);

  let detail: { session: SessionInfo; machine: MachineState } | null = null;
  if (hash.startsWith('#/s/')) {
    const gid = decodeURIComponent(hash.slice(4));
    for (const m of machines) {
      const s = m.sessions.find((x) => x.globalId === gid);
      if (s) {
        detail = { session: s, machine: m };
        break;
      }
    }
  }

  if (detail)
    return (
      <>
        <SessionDetail session={detail.session} machine={detail.machine} />
        <ToastHost />
      </>
    );

  // dentro del APK sin ningún hub conocido: primer arranque
  if (ready && isNative() && hubList.length === 0)
    return (
      <>
        <HubSetup />
        <ToastHost />
      </>
    );

  // la PWA de un hub que aún no tiene su token en este dispositivo
  const origin = hubList.find((h) => h.source === 'origin');
  if (ready && !isNative() && origin?.status === 'unauthorized')
    return (
      <>
        <HubSetup fixedUrl={origin.url} />
        <ToastHost />
      </>
    );

  const totalSessions = machines.reduce((n, m) => n + m.sessions.length, 0);
  const openHubs = hubList.filter((h) => h.status === 'open').length;
  const connLabel =
    conn === 'open'
      ? hubList.length > 1
        ? `en vivo · ${openHubs}/${hubList.length} hubs`
        : 'en vivo'
      : conn === 'connecting'
        ? 'conectando…'
        : conn === 'unauthorized'
          ? 'falta el token'
          : 'sin conexión';

  return (
    <div className="mx-auto min-h-full max-w-3xl overflow-x-hidden px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/25 to-emerald-900/30 text-xl shadow-lg shadow-emerald-950/40">
            ✳️
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Claude <span className="text-emerald-300">Sessions</span>
            </h1>
            <p className="text-xs text-zinc-400">
              {totalSessions} {totalSessions === 1 ? 'sesión' : 'sesiones'} ·{' '}
              {machines.filter((m) => m.online).length}/{machines.length}{' '}
              {machines.length === 1 ? 'máquina' : 'máquinas'} online
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowHubs(true)}
          title="hubs (paneles) conectados"
          aria-label="Hubs"
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition active:scale-95 ${
            conn === 'open'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : conn === 'connecting'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              conn === 'open' ? 'bg-emerald-400' : conn === 'connecting' ? 'bg-amber-400 pulse-dot' : 'bg-red-500'
            }`}
          />
          {connLabel}
          <span className="text-zinc-500">⚙</span>
        </button>
      </header>

      {!isNative() && <InstallApp />}

      {machines.length === 0 && (
        <div className="card-in rounded-3xl border border-dashed border-zinc-700 bg-zinc-900/40 p-10 text-center text-zinc-400">
          <p className="mb-3 text-4xl">👋</p>
          <p className="mb-2 text-lg font-semibold text-zinc-200">Aún no hay máquinas</p>
          <p className="text-sm leading-6">
            Instala el agente en una máquina y aparecerá aquí sola:
            <br />
            <code className="mt-2 inline-block break-all rounded-lg bg-zinc-800 px-2 py-1 text-emerald-300">
              curl -fsSL http://&lt;hub&gt;:4000/install.sh | sh
            </code>
          </p>
        </div>
      )}

      <div className="space-y-5">
        {machines.map((m) => (
          <MachineGroup key={m.info.id} machine={m} />
        ))}
      </div>
      {showHubs && <HubsSheet onClose={() => setShowHubs(false)} />}
      <ToastHost />
    </div>
  );
}
