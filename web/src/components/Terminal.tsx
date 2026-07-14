import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { wsClient } from '../ws';

export default function Terminal({ globalId }: { globalId: string }) {
  const ref = useRef<HTMLDivElement>(null);

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

    const off = wsClient.onMessage((msg) => {
      if (msg.type !== 'output' || msg.sessionId !== globalId) return;
      if (msg.full) term.reset();
      term.write(msg.data);
    });
    wsClient.subscribe(globalId);

    return () => {
      off();
      wsClient.unsubscribe(globalId);
      ro.disconnect();
      term.dispose();
    };
  }, [globalId]);

  return <div ref={ref} className="h-full w-full" />;
}
