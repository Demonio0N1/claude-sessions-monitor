import { useEffect, useRef, useState } from 'react';
import type { DirEntry, DirListing, MachineState } from '../types';
import { runMachineAction } from '../actions';
import { prepareUpload } from '../image';
import { toast } from '../toast';

const MAX_MB = 30;

interface FileStatus {
  name: string;
  state: 'subiendo' | 'ok' | 'error';
  detail?: string;
}

function fmtBytes(n?: number): string {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return '🖼';
  if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'm4a', 'flac'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📕';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return '🗜';
  if (['js', 'ts', 'tsx', 'py', 'go', 'rs', 'c', 'cpp', 'sh', 'rb', 'json', 'html', 'css'].includes(ext))
    return '📜';
  return '📄';
}

/**
 * Explorador de archivos de la máquina remota: navegar, subir (galería o
 * archivos), descargar, renombrar, eliminar, crear carpetas y abrir ahí una
 * sesión de Claude o un terminal.
 */
export default function FilesModal({
  machine,
  onClose,
  initialPath,
  onPick,
}: {
  machine: MachineState;
  onClose: () => void;
  /** carpeta donde empezar (p. ej. el cwd de la sesión); por defecto, $HOME */
  initialPath?: string;
  /** si viene, los archivos ofrecen "Usar con Claude": entrega la ruta elegida */
  onPick?: (path: string) => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null); // path del archivo con menú abierto
  const [original, setOriginal] = useState(false); // subir imágenes sin comprimir
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const navigate = async (path?: string) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    const res = await runMachineAction(machine.info.id, 'list_dir', { path });
    setLoading(false);
    if (res.ok) setListing(res.data as DirListing);
    else setError(res.message ?? 'no se pudo listar la carpeta');
  };

  const refresh = () => navigate(listing?.path);

  useEffect(() => {
    void navigate(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // las imágenes se comprimen en el teléfono (sube ~10x más rápido),
        // salvo que se pida calidad original
        const prep = await prepareUpload(f, !original);
        res = await runMachineAction(machine.info.id, 'put_file', {
          path: dest,
          name: prep.name,
          data: prep.dataUrl,
        });
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
    void refresh();
  };

  const download = async (e: DirEntry) => {
    setBusy(true);
    toast(`Descargando ${e.name}…`);
    const res = await runMachineAction(machine.info.id, 'get_file', { path: e.path });
    setBusy(false);
    if (!res.ok) {
      toast(res.message ?? 'no se pudo descargar', 'error');
      return;
    }
    const { data } = res.data as { name: string; data: string };
    const a = document.createElement('a');
    a.href = data;
    a.download = e.name;
    a.click();
  };

  const rename = async (e: DirEntry) => {
    const name = prompt(`Nuevo nombre para ${e.name}:`, e.name)?.trim();
    if (!name || name === e.name) return;
    const res = await runMachineAction(machine.info.id, 'rename_path', { path: e.path, name });
    toast(res.message ?? (res.ok ? 'renombrado' : 'no se pudo renombrar'), res.ok ? 'ok' : 'error');
    if (res.ok) void refresh();
  };

  const remove = async (e: DirEntry) => {
    if (!confirm(`¿Eliminar ${e.dir ? 'la carpeta' : ''} "${e.name}"?`)) return;
    const res = await runMachineAction(machine.info.id, 'delete_path', { path: e.path });
    toast(res.message ?? (res.ok ? 'eliminado' : 'no se pudo eliminar'), res.ok ? 'ok' : 'error');
    if (res.ok) void refresh();
  };

  const newFolder = async () => {
    if (!listing) return;
    const name = prompt('Nombre de la carpeta nueva:')?.trim();
    if (!name) return;
    const res = await runMachineAction(machine.info.id, 'mkdir', { path: listing.path, name });
    toast(res.message ?? (res.ok ? 'carpeta creada' : 'no se pudo crear'), res.ok ? 'ok' : 'error');
    if (res.ok) void refresh();
  };

  const launch = async (what: 'claude' | 'terminal') => {
    if (!listing || busy) return;
    setBusy(true);
    const res = await runMachineAction(
      machine.info.id,
      what === 'claude' ? 'new_session' : 'new_terminal',
      { path: listing.path },
    );
    setBusy(false);
    toast(res.message ?? (res.ok ? 'listo' : 'no se pudo abrir'), res.ok ? 'ok' : 'error');
    if (res.ok) onClose();
  };

  const shownPath = listing
    ? listing.path === listing.home
      ? '~'
      : listing.path.startsWith(listing.home + '/')
        ? '~' + listing.path.slice(listing.home.length)
        : listing.path
    : '';

  const actBtn =
    'flex-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 active:scale-95';

  return (
    <div
      className="backdrop-in fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="modal-in flex max-h-[90dvh] min-h-[70dvh] w-full max-w-lg flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold">
            Archivos de <span className="text-emerald-300">{machine.info.name}</span>
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
            <p className="px-2 py-3 text-sm text-zinc-500">Carpeta vacía.</p>
          ) : (
            listing?.entries.map((e) => {
              const isDir = e.dir !== false && (e.dir === true || e.size === undefined);
              return (
                <div key={e.path}>
                  <button
                    onClick={() => (isDir ? navigate(e.path) : setSelected(selected === e.path ? null : e.path))}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm active:bg-zinc-800 ${
                      selected === e.path ? 'bg-zinc-800/80' : ''
                    } ${isDir ? 'text-zinc-200' : 'text-zinc-300'}`}
                  >
                    <span aria-hidden>{isDir ? '📁' : fileIcon(e.name)}</span>
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {!isDir && <span className="shrink-0 text-[11px] text-zinc-500">{fmtBytes(e.size)}</span>}
                    {isDir && <span className="text-zinc-600">›</span>}
                  </button>
                  {selected === e.path && !isDir && (
                    <div className="mb-1 flex gap-1.5 px-2 pb-1 pt-0.5">
                      {onPick && (
                        <button
                          onClick={() => {
                            onPick(e.path);
                            onClose();
                          }}
                          disabled={busy}
                          className={`${actBtn} border-emerald-700/60 bg-emerald-950/40 text-emerald-300`}
                        >
                          ✳️ Usar con Claude
                        </button>
                      )}
                      <button onClick={() => download(e)} disabled={busy} className={actBtn}>
                        ⬇ Descargar
                      </button>
                      <button onClick={() => rename(e)} disabled={busy} className={actBtn}>
                        ✏️ Renombrar
                      </button>
                      <button
                        onClick={() => remove(e)}
                        disabled={busy}
                        className={`${actBtn} border-red-800/60 text-red-300`}
                      >
                        🗑 Eliminar
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {files.length > 0 && (
          <div className="max-h-28 overflow-y-auto border-t border-zinc-800 px-4 py-2">
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

        <div className="space-y-2 border-t border-zinc-800 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={original}
              onChange={(e) => setOriginal(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            Subir imágenes en calidad original (más lento)
          </label>
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
          <div className="flex gap-2">
            <button
              onClick={() => photoInput.current?.click()}
              disabled={!listing || loading || busy}
              className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? '…' : '📷 Fotos'}
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={!listing || loading || busy}
              className="flex-1 rounded-xl border border-emerald-700/60 bg-emerald-950/40 px-3 py-2.5 text-sm font-semibold text-emerald-300 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? '…' : '📄 Archivos'}
            </button>
            <button
              onClick={newFolder}
              disabled={!listing || loading || busy}
              className="rounded-xl border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 active:scale-[0.98] disabled:opacity-50"
              title="crear carpeta aquí"
            >
              📁+
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => launch('claude')}
              disabled={!listing || loading || busy}
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-100 active:scale-[0.98] disabled:opacity-50"
            >
              ✳️ Claude aquí
            </button>
            <button
              onClick={() => launch('terminal')}
              disabled={!listing || loading || busy}
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-100 active:scale-[0.98] disabled:opacity-50"
            >
              🖥 Terminal aquí
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
