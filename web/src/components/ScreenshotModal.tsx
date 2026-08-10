import { useEffect, useState } from 'react';
import type { MachineState } from '../types';
import { runMachineAction } from '../actions';

/** Modal que pide al agente una captura de la pantalla de la máquina y la muestra. */
export default function ScreenshotModal({
  machine,
  onClose,
}: {
  machine: MachineState;
  onClose: () => void;
}) {
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const capture = async () => {
    setLoading(true);
    setError(null);
    const res = await runMachineAction(machine.info.id, 'screenshot');
    setLoading(false);
    if (res.ok) setImg((res.data as { image: string }).image);
    else setError(res.message ?? 'no se pudo capturar la pantalla');
  };

  useEffect(() => {
    void capture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4 backdrop-in"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-2xl modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold">
            Pantalla de <span className="text-emerald-300">{machine.info.name}</span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={capture}
              disabled={loading}
              className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 active:scale-95 disabled:opacity-40"
            >
              ↻ actualizar
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-zinc-400 active:scale-95"
              aria-label="cerrar"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-40 flex-1 overflow-auto p-2">
          {loading ? (
            <p className="px-2 py-8 text-center text-sm text-zinc-500">Capturando pantalla…</p>
          ) : error ? (
            <div className="px-2 py-6 text-center text-sm text-red-300">
              <p>{error}</p>
              {machine.info.os === 'darwin' && (
                <p className="mt-2 text-zinc-400">
                  Si la imagen sale vacía o falla, autoriza <b>csm-agent</b> en Ajustes del Sistema →
                  Privacidad y seguridad → Grabación de pantalla.
                </p>
              )}
            </div>
          ) : (
            img && (
              <img
                src={img}
                alt={`pantalla de ${machine.info.name}`}
                className="w-full rounded-lg border border-zinc-800"
              />
            )
          )}
        </div>

        {img && !loading && (
          <p className="border-t border-zinc-800 px-4 py-2 text-center text-xs text-zinc-500">
            Mantén pulsada la imagen para guardarla o compartirla.
          </p>
        )}
      </div>
    </div>
  );
}
