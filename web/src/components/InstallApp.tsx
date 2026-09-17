import { useEffect, useState } from 'react';
import { hubs } from '../hubs/store';

const HIDE_KEY = 'csm-hide-apk';

/**
 * Solo en el navegador: si este hub sirve el APK (/bin/csm.apk), ofrece
 * descargarlo y, en Android, abrir la app ya instalada con este hub y su token
 * (deep link csm://hub?url=…&token=…, con el APK como respaldo si aún no está
 * instalada). El token viaja en el enlace porque esta página ya está emparejada.
 */
export default function InstallApp() {
  const [apk, setApk] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (hidden) return;
    fetch('/bin/csm.apk', { method: 'HEAD' })
      .then((r) => {
        if (r.ok) setApk(`${location.origin}/bin/csm.apk`);
      })
      .catch(() => {});
  }, [hidden]);

  if (hidden || !apk) return null;
  const android = /android/i.test(navigator.userAgent);
  const token = hubs.tokenFor(location.origin);
  const data = `hub?url=${encodeURIComponent(location.origin)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  const intent = `intent://${data}#Intent;scheme=csm;package=com.csm.app;S.browser_fallback_url=${encodeURIComponent(apk)};end`;
  const btn = 'rounded-xl border px-3 py-1.5 text-xs font-semibold transition active:scale-95';

  return (
    <div className="card-in mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
      <p className="min-w-[12rem] flex-1 text-sm text-zinc-300">
        📱 <b className="text-zinc-100">App Android</b>: todas tus máquinas en un solo panel, sin
        escribir direcciones.
      </p>
      {android && (
        <a href={intent} className={`${btn} border-emerald-600/50 bg-emerald-600 text-white`}>
          Abrir en la app
        </a>
      )}
      <a href={apk} className={`${btn} border-zinc-700 bg-zinc-800/60 text-zinc-200`}>
        Descargar APK
      </a>
      <button
        onClick={() => {
          try {
            localStorage.setItem(HIDE_KEY, '1');
          } catch {
            /* sin almacenamiento */
          }
          setHidden(true);
        }}
        className="rounded-lg px-2 py-1 text-zinc-500 active:scale-95"
        aria-label="ocultar"
        title="no volver a mostrar"
      >
        ✕
      </button>
    </div>
  );
}
