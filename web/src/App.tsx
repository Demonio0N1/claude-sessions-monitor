import { useEffect, useState } from 'react';
import type { MachineState, SessionInfo } from './types';
import { wsClient, type ConnStatus } from './ws';
import MachineGroup from './components/MachineGroup';
import SessionDetail from './components/SessionDetail';
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
  const [machines, setMachines] = useState<MachineState[]>([]);
  const [conn, setConn] = useState<ConnStatus>(wsClient.status);
  const hash = useHashRoute();
  const [, setTick] = useState(0);

  useEffect(() => {
    const offMsg = wsClient.onMessage((msg) => {
      if (msg.type === 'state') setMachines(msg.machines);
    });
    const offStatus = wsClient.onStatus(setConn);
    const iv = setInterval(() => setTick((t) => t + 1), 30_000); // refresca "hace Xm"
    return () => {
      offMsg();
      offStatus();
      clearInterval(iv);
    };
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

  const totalSessions = machines.reduce((n, m) => n + m.sessions.length, 0);

  if (detail)
    return (
      <>
        <SessionDetail session={detail.session} machine={detail.machine} />
        <ToastHost />
      </>
    );

  return (
    <div className="mx-auto min-h-full max-w-3xl overflow-x-hidden px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Claude Sessions</h1>
          <p className="text-sm text-zinc-400">
            {totalSessions} {totalSessions === 1 ? 'sesión' : 'sesiones'} ·{' '}
            {machines.filter((m) => m.online).length}/{machines.length} máquinas online
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              conn === 'open' ? 'bg-emerald-400' : conn === 'connecting' ? 'bg-amber-400 pulse-dot' : 'bg-red-500'
            }`}
          />
          {conn === 'open' ? 'conectado' : conn === 'connecting' ? 'conectando…' : 'sin conexión'}
        </div>
      </header>

      {machines.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-8 text-center text-zinc-400">
          <p className="mb-2 text-lg">Sin máquinas registradas</p>
          <p className="text-sm">
            Instala el agente en una máquina:{' '}
            <code className="break-all rounded bg-zinc-800 px-1.5 py-0.5 text-emerald-300">
              curl -fsSL http://&lt;hub&gt;:4000/install.sh | sh
            </code>
          </p>
        </div>
      )}

      <div className="space-y-6">
        {machines.map((m) => (
          <MachineGroup key={m.info.id} machine={m} />
        ))}
      </div>
      <ToastHost />
    </div>
  );
}
