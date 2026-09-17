import { useState } from 'react';
import { normalizeHubUrl, probeHub } from '../hubs/HubClient';
import { hubs } from '../hubs/store';

/** Primer arranque dentro del APK: todavía no conocemos ningún hub. */
export default function HubSetup() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const norm = normalizeHubUrl(url);
    if (!norm) {
      setError('Escribe la dirección del panel, por ejemplo http://100.115.114.47:4000');
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await probeHub(norm);
    setBusy(false);
    if (!ok) {
      setError(`${norm} no responde. ¿Tailscale está conectado en el teléfono y el hub encendido?`);
      return;
    }
    hubs.addHub(norm, 'user');
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="card-in rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/30">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/25 to-emerald-900/30 text-xl">
            ✳️
          </div>
          <h1 className="text-xl font-bold tracking-tight">
            Claude <span className="text-emerald-300">Sessions</span>
          </h1>
        </div>
        <h2 className="mb-2 text-base font-semibold text-zinc-100">Conecta con tu panel</h2>
        <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-zinc-300">
          <li>Activa Tailscale en este teléfono.</li>
          <li>
            Abre el panel en Chrome (<code className="text-emerald-300">http://&lt;ip-tailscale&gt;:4000</code>) y toca{' '}
            <b className="text-white">«Abrir en la app»</b>.
          </li>
        </ol>
        <p className="mb-2 text-xs text-zinc-500">O pega aquí la dirección de cualquier hub tuyo:</p>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void connect()}
          placeholder="http://100.x.x.x:4000"
          inputMode="url"
          autoCapitalize="none"
          className="mb-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 font-mono text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500/60"
        />
        {error && <p className="mb-2 text-xs leading-5 text-red-300">{error}</p>}
        <button
          onClick={() => void connect()}
          disabled={busy || !url.trim()}
          className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? 'Comprobando…' : 'Conectar'}
        </button>
        <p className="mt-4 text-[11px] leading-4 text-zinc-500">
          Con un solo hub basta: la app le pregunta qué otras máquinas tuyas tienen panel y las
          muestra todas juntas.
        </p>
      </div>
    </div>
  );
}
