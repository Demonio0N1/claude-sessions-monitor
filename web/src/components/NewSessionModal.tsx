import { useEffect, useState } from 'react';
import type { DirListing, MachineState } from '../types';
import { runMachineAction } from '../actions';
import { toast } from '../toast';
import { AGENT_OPTIONS } from '../agents';

/**
 * Modal para crear una sesión csm nueva: navega las carpetas de la máquina
 * remota (vía el agente) y lanza el CLI elegido (Claude, Codex, OpenCode o
 * Cursor) en la carpeta elegida.
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
  const [agent, setAgent] = useState(AGENT_OPTIONS[0].kind);
  const [gateway, setGateway] = useState(false);
  const agentLabel = AGENT_OPTIONS.find((a) => a.kind === agent)?.label ?? 'Claude';

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
      agent,
      gateway,
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
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4 backdrop-in"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-2xl modal-in"
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
          ) : listing && listing.entries.filter((e) => e.dir !== false).length === 0 ? (
            <p className="px-2 py-3 text-sm text-zinc-500">Sin subcarpetas. Puedes abrir la sesión aquí.</p>
          ) : (
            listing?.entries
              .filter((e) => e.dir !== false) // los agentes nuevos listan también archivos
              .map((e) => (
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
          <div>
            <p className="mb-1.5 text-xs text-zinc-500">Agente</p>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_OPTIONS.map((a) => (
                <button
                  key={a.kind}
                  onClick={() => setAgent(a.kind)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium active:scale-95 ${
                    agent === a.kind
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                      : 'border-zinc-700 text-zinc-300'
                  }`}
                >
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={fresh}
              onChange={(e) => setFresh(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Empezar de cero (ignorar conversación previa)
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={gateway}
              onChange={(e) => setGateway(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Usar OmniRoute (modelos gratis/baratos, requiere tenerlo corriendo en esa máquina)
          </label>
          <button
            onClick={create}
            disabled={!listing || loading || creating}
            className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
          >
            {creating ? 'Creando sesión…' : `▶ Abrir ${agentLabel} en ${shownPath || 'esta carpeta'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
