import { useEffect, useRef, useState } from 'react';
import type { DirListing, MachineState } from '../types';
import { runMachineAction } from '../actions';
import { toast } from '../toast';

const MAX_MB = 30;

interface FileStatus {
  name: string;
  state: 'subiendo' | 'ok' | 'error';
  detail?: string;
}

/**
 * Modal para subir archivos o fotos del teléfono a la máquina remota:
 * navegas sus carpetas (vía el agente), eliges destino y seleccionas archivos
 * (en móvil el selector ofrece galería o archivos según el botón).
 */
export default function UploadModal({
  machine,
  onClose,
  initialPath,
}: {
  machine: MachineState;
  onClose: () => void;
  /** carpeta donde empezar (p. ej. el cwd de la sesión); por defecto, $HOME */
  initialPath?: string;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const navigate = async (path?: string) => {
    setLoading(true);
    setError(null);
    const res = await runMachineAction(machine.info.id, 'list_dir', { path });
    setLoading(false);
    if (res.ok) setListing(res.data as DirListing);
    else setError(res.message ?? 'no se pudo listar la carpeta');
  };

  useEffect(() => {
    void navigate(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readAsDataURL = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0 || !listing || busy) return;
    setBusy(true);
    const dest = listing.path;
    for (const f of Array.from(list)) {
      if (f.size > MAX_MB * 1024 * 1024) {
        setFiles((p) => [...p, { name: f.name, state: 'error', detail: `supera ${MAX_MB} MB` }]);
        continue;
      }
      setFiles((p) => [...p, { name: f.name, state: 'subiendo' }]);
      let res;
      try {
        const data = await readAsDataURL(f);
        res = await runMachineAction(machine.info.id, 'put_file', { path: dest, name: f.name, data });
      } catch {
        res = { ok: false, message: 'no se pudo leer el archivo' };
      }
      setFiles((p) =>
        p.map((s, i) =>
          i === p.length - 1
            ? { name: s.name, state: res.ok ? 'ok' : 'error', detail: res.message }
            : s,
        ),
      );
      if (!res.ok) toast(`${f.name}: ${res.message ?? 'error al subir'}`, 'error');
    }
    setBusy(false);
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
            Subir a <span className="text-emerald-300">{machine.info.name}</span>
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

        <div className="min-h-28 flex-1 overflow-y-auto px-2 py-2">
          {error ? (
            <p className="px-2 py-3 text-sm text-red-300">{error}</p>
          ) : loading ? (
            <p className="px-2 py-3 text-sm text-zinc-500">Cargando…</p>
          ) : listing && listing.entries.length === 0 ? (
            <p className="px-2 py-3 text-sm text-zinc-500">Sin subcarpetas. Puedes subir aquí.</p>
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

        {files.length > 0 && (
          <div className="max-h-32 overflow-y-auto border-t border-zinc-800 px-4 py-2">
            {files.map((f, i) => (
              <p key={i} className="flex items-center gap-2 py-0.5 text-xs">
                <span aria-hidden>
                  {f.state === 'subiendo' ? '⏳' : f.state === 'ok' ? '✅' : '❌'}
                </span>
                <span className="truncate text-zinc-300">{f.name}</span>
                {f.detail && <span className="ml-auto shrink-0 text-zinc-500">{f.detail}</span>}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-2 border-t border-zinc-800 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <input
            ref={photoInput}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => photoInput.current?.click()}
            disabled={!listing || loading || busy}
            className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Subiendo…' : '📷 Fotos'}
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={!listing || loading || busy}
            className="flex-1 rounded-xl border border-emerald-700/60 bg-emerald-950/40 px-3 py-2.5 text-sm font-semibold text-emerald-300 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Subiendo…' : '📄 Archivos'}
          </button>
        </div>
      </div>
    </div>
  );
}
