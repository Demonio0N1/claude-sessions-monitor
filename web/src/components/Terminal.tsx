import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { wsClient } from '../ws';

export default function Terminal({ globalId, title }: { globalId: string; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  // true mientras el usuario está desplazado hacia arriba leyendo historial
  const [paused, setPaused] = useState(false);
  const [gpu, setGpu] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const term = new XTerm({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontSize: 12.5,
      lineHeight: 1.25,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      scrollback: 3000,
      smoothScrollDuration: 120,
      theme: {
        background: '#0a0a0c',
        foreground: '#e4e4e7',
        cursor: '#0a0a0c',
        selectionBackground: '#3f3f46',
      },
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    term.write('\x1b[90mEsperando salida…\x1b[0m');

    // Renderer GPU: mucho más fluido en scroll/redraw con salidas largas.
    // No todos los navegadores/webviews móviles soportan WebGL2 de forma
    // estable, así que si falla (o se pierde el contexto luego) cae solo
    // al renderer DOM por defecto de xterm.
    let webgl: WebglAddon | null = new WebglAddon();
    try {
      term.loadAddon(webgl);
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
        setGpu(false);
      });
      setGpu(true);
    } catch {
      webgl?.dispose();
      webgl = null;
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* elemento oculto */
      }
    });
    ro.observe(el);

    // Cada actualización llega como pantalla completa (reset + write), lo que
    // arrastraría la vista al fondo. Si el usuario subió a leer historial, se
    // guarda la última pantalla en `pending` y se aplica al volver abajo.
    let pending: string | null = null;
    const atBottom = () => {
      const b = term.buffer.active;
      return b.viewportY >= b.baseY;
    };
    const applyFull = (data: string) => {
      term.reset();
      term.write(data);
    };

    const off = wsClient.onMessage((msg) => {
      if (msg.type !== 'output' || msg.sessionId !== globalId) return;
      if (!msg.full) {
        term.write(msg.data);
        return;
      }
      if (atBottom()) {
        applyFull(msg.data);
      } else {
        pending = msg.data;
        setPaused(true);
      }
    });

    const offScroll = term.onScroll(() => {
      if (atBottom()) {
        if (pending !== null) {
          const data = pending;
          pending = null;
          applyFull(data);
        }
        setPaused(false);
      } else {
        setPaused(true);
      }
    });

    wsClient.subscribe(globalId);

    return () => {
      off();
      offScroll.dispose();
      wsClient.unsubscribe(globalId);
      ro.disconnect();
      webgl?.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [globalId]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#0a0a0c] shadow-lg shadow-black/30">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/80 bg-zinc-900/50 px-3 py-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
        <span className="ml-1.5 truncate font-mono text-[11px] text-zinc-500">
          {title ?? 'terminal'}
        </span>
        <span
          className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
            gpu ? 'text-emerald-500/70' : 'text-zinc-600'
          }`}
          title={gpu ? 'Renderizado acelerado por GPU (WebGL)' : 'Renderizado estándar (DOM)'}
        >
          {gpu ? 'GPU' : ''}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 px-2 py-1.5">
        <div ref={ref} className="h-full w-full" />
        {paused && (
          <button
            onClick={() => termRef.current?.scrollToBottom()}
            className="absolute bottom-2 right-3 z-10 rounded-full border border-emerald-700/60 bg-emerald-950/80 px-3 py-1 text-xs font-semibold text-emerald-300 shadow-lg backdrop-blur active:scale-95"
          >
            ⬇ en vivo
          </button>
        )}
      </div>
    </div>
  );
}
