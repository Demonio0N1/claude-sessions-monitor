import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { wsClient } from '../ws';

export default function Terminal({ globalId }: { globalId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  // true mientras el usuario está desplazado hacia arriba leyendo historial
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const term = new XTerm({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      scrollback: 3000,
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
        cursor: '#09090b',
        selectionBackground: '#3f3f46',
      },
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    term.write('\x1b[90mEsperando salida…\x1b[0m');

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
      term.dispose();
      termRef.current = null;
    };
  }, [globalId]);

  return (
    <div className="relative h-full w-full">
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
  );
}
