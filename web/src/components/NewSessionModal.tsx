import { useEffect, useState } from 'react';
import type { DirListing, MachineState } from '../types';
import { runMachineAction } from '../actions';
import { toast } from '../toast';

/**
 * Modal para crear una sesión csm nueva: navega las carpetas de la máquina
 * remota (vía el agente) y lanza Claude en la carpeta elegida.
 */
export default function NewSessionModal({
  machine,
  onClose,
}: {
  machine: MachineState;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [creating, setCreating] = useState(false);

  const navigate = async (path?: string) => {
    setLoading(true);
    setError(null);
    const res = await runMachineAction(machine.info.id, 'list_dir', { path });
    setLoading(false);
    if (res.ok) setListing(res.data as DirListing);
    else setError(res.message ?? 'no se pudo listar la carpeta');
  };

  useEffect(() => {
    void navigate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!listing || creating) return;
    setCreating(true);
    const res = await runMachineAction(machine.info.id, 'new_session', {
      path: listing.path,
      fresh,
    });
    setCreating(false);
    if (res.ok) {
      toast(res.message ?? 'sesión creada');
      onClose();
    } else {
      toast(res.message ?? 'no se pudo crear la sesión', 'error');
    }
  };

  const shownPath = listing
    ? listing.path === listing.home
      ? '~'
      : listing.path.startsWith(listing.home + '/')
        ? '~' + listing.path.slice(listing.home.length)
        : listing.path
    : '';

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold">
            Nueva sesión en <span className="text-emerald-300">{machine.info.name}</span>
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 active:scale-95"
            aria-label="cerrar"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
          <button
            onClick={() => navigate(listing?.home)}
            disabled={loading}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 active:scale-95"
            title="ir a la carpeta personal"
          >
            ⌂
          </button>
          <button
            onClick={() => listing?.parent && navigate(listing.parent)}
            disabled={loading || !listing?.parent}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 active:scale-95 disabled:opacity-40"
            title="subir un nivel"
          >
            ← subir
          </button>
          <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-zinc-400" dir="rtl">
            {shownPath}
          </span>
        </div>

        <div className="min-h-32 flex-1 overflow-y-auto px-2 py-2">
          {error ? (
            <p className="px-2 py-3 text-sm text-red-300">{error}</p>
          ) : loading ? (
            <p className="px-2 py-3 text-sm text-zinc-500">Cargando…</p>
          ) : listing && listing.entries.length === 0 ? (
            <p className="px-2 py-3 text-sm text-zinc-500">Sin subcarpetas. Puedes abrir la sesión aquí.</p>
          ) : (
            listing?.entries.map((e) => (
              <button
                key={e.path}
                onClick={() => navigate(e.path)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-zinc-200 active:bg-zinc-800"
              >
                <span aria-hidden>📁</span>
                <span className="truncate">{e.name}</span>
                <span className="ml-auto text-zinc-600">›</span>
              </button>
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-zinc-800 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={fresh}
              onChange={(e) => setFresh(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Empezar de cero (ignorar conversación previa)
          </label>
          <button
            onClick={create}
            disabled={!listing || loading || creating}
            className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
          >
            {creating ? 'Creando sesión…' : `▶ Abrir Claude en ${shownPath || 'esta carpeta'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
