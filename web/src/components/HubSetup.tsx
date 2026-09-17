import { useState } from 'react';
import { checkToken, normalizeHubUrl, pingHub, tokenFromLink } from '../hubs/HubClient';
import { hubs } from '../hubs/store';

/**
 * Emparejamiento con un hub. Sin `fixedUrl`: primer arranque dentro del APK
 * (pide URL + token). Con `fixedUrl`: la PWA del propio hub, que solo necesita
 * el token (o el enlace del panel que lo lleva en #t=…).
 */
export default function HubSetup({ fixedUrl }: { fixedUrl?: string }) {
  const [url, setUrl] = useState(fixedUrl ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    // se acepta pegar el enlace completo del panel en cualquiera de los dos campos
    const norm = normalizeHubUrl(fixedUrl ?? url.replace(/[#?].*$/, ''));
    const tok = (tokenFromLink(token) ?? tokenFromLink(url) ?? token).trim();
    if (!norm) {
      setError('Escribe la dirección del panel, por ejemplo http://100.115.114.47:4000');
      return;
    }
    if (!tok) {
      setError('Falta el token del hub.');
      return;
    }
    setBusy(true);
    setError(null);
    const ping = await pingHub(norm);
    if (!ping) {
      setBusy(false);
      setError(`${norm} no responde. ¿Tailscale está conectado y el hub encendido?`);
      return;
    }
    const ok = await checkToken(norm, tok);
    setBusy(false);
    if (!ok) {
      setError('Token incorrecto para ese hub.');
      return;
    }
    hubs.addHub(norm, fixedUrl ? 'origin' : 'user', ping.name, tok);
  }

  const input =
    'mb-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 font-mono text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500/60';

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
        <h2 className="mb-2 text-base font-semibold text-zinc-100">
          {fixedUrl ? 'Este panel pide emparejamiento' : 'Conecta con tu panel'}
        </h2>
        <p className="mb-4 text-sm leading-6 text-zinc-300">
          {fixedUrl ? (
            <>
              Pega el <b className="text-white">token del hub</b> (lo muestra{' '}
              <code className="text-emerald-300">./scripts/hub-service.sh status</code> en esa máquina) o abre el
              enlace del panel que lo incluye (<code className="text-emerald-300">…/#t=…</code>). Solo hace falta
              una vez en este dispositivo.
            </>
          ) : (
            <>
              Con Tailscale activo en este teléfono, abre el panel en Chrome y toca{' '}
              <b className="text-white">«Abrir en la app»</b>, o pega aquí la dirección y el token del hub
              (los muestra <code className="text-emerald-300">./scripts/hub-service.sh status</code>).
            </>
          )}
        </p>
        {!fixedUrl && (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://100.x.x.x:4000"
            inputMode="url"
            autoCapitalize="none"
            className={input}
          />
        )}
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void connect()}
          placeholder="token del hub (o enlace con #t=…)"
          autoCapitalize="none"
          autoComplete="off"
          className={input}
        />
        {error && <p className="mb-2 text-xs leading-5 text-red-300">{error}</p>}
        <button
          onClick={() => void connect()}
          disabled={busy || (!fixedUrl && !url.trim()) || !token.trim()}
          className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? 'Comprobando…' : 'Conectar'}
        </button>
        <p className="mt-4 text-[11px] leading-4 text-zinc-500">
          Con un solo hub basta: la app le pregunta qué otras máquinas tuyas tienen panel y entra en
          ellas con el token que ese hub ya conoce.
        </p>
      </div>
    </div>
  );
}
