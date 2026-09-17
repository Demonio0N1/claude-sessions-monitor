import { useState } from 'react';
import type { ConnStatus } from '../hubs/HubClient';
import { normalizeHubUrl, probeHub } from '../hubs/HubClient';
import { hubs, useHubs, type HubSource } from '../hubs/store';
import { isNative } from '../hubs/native';
import { toast } from '../toast';

const DOT: Record<ConnStatus, string> = {
  open: 'bg-emerald-400',
  connecting: 'bg-amber-400 pulse-dot',
  closed: 'bg-red-500',
};
const STATUS_LABEL: Record<ConnStatus, string> = {
  open: 'conectado',
  connecting: 'conectando…',
  closed: 'sin conexión',
};
const SOURCE_LABEL: Record<HubSource, string> = {
  origin: 'esta página',
  user: 'agregado',
  discovery: 'descubierto',
};

/** Lista de hubs (paneles) a los que está conectada la app, con alta/baja manual. */
export default function HubsSheet({ onClose }: { onClose: () => void }) {
  const { hubs: list } = useHubs();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const norm = normalizeHubUrl(url);
    if (!norm) {
      toast('Escribe una URL o IP válida', 'error');
      return;
    }
    setBusy(true);
    const ok = await probeHub(norm);
    setBusy(false);
    if (!ok) {
      toast(`${norm} no responde como panel de csm`, 'error');
      return;
    }
    hubs.addHub(norm, 'user');
    setUrl('');
    toast('Hub agregado ✓');
  }

  async function search() {
    setBusy(true);
    await hubs.discoverNow();
    setBusy(false);
    toast('Búsqueda en la tailnet terminada');
  }

  return (
    <div
      className="backdrop-in fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="modal-in flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold">Hubs (paneles)</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-400 active:scale-95" aria-label="cerrar">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {list.map((h) => (
            <div key={h.url} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[h.status]}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-100">{h.name}</p>
                <p className="truncate font-mono text-[11px] text-zinc-500">{h.url}</p>
                <p className="text-[11px] text-zinc-500">
                  {STATUS_LABEL[h.status]} · {h.machines} {h.machines === 1 ? 'máquina' : 'máquinas'} ·{' '}
                  {SOURCE_LABEL[h.source]}
                </p>
              </div>
              {h.source !== 'origin' && (
                <button
                  onClick={() => hubs.removeHub(h.url)}
                  className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 active:scale-95"
                  title="quitar este hub"
                >
                  quitar
                </button>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-sm text-zinc-500">Aún no hay hubs.</p>}
        </div>

        <div className="space-y-2 border-t border-zinc-800 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
              placeholder="http://100.x.x.x:4000"
              inputMode="url"
              autoCapitalize="none"
              className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500/60"
            />
            <button
              onClick={() => void add()}
              disabled={busy || !url.trim()}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-40"
            >
              Agregar
            </button>
          </div>
          <button
            onClick={() => void search()}
            disabled={busy || !list.some((h) => h.status === 'open')}
            className="w-full rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? 'Buscando…' : '🔍 Buscar paneles en la tailnet'}
          </button>
          <p className="text-[11px] leading-4 text-zinc-500">
            Cada hub le pregunta a Tailscale qué otras máquinas tuyas tienen panel; la app se
            conecta a todos y muestra una sola lista. Si un hub se apaga, sigues viendo el resto.
            {!isNative() && ' Los hubs descubiertos desde el navegador no se guardan.'}
          </p>
        </div>
      </div>
    </div>
  );
}
