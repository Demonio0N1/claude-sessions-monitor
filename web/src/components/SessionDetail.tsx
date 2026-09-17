import { useEffect, useRef, useState } from 'react';
import type { EventRow, MachineState, SessionInfo } from '../types';
import { eventLabel, timeAgo, uptime } from '../format';
import { promptHistory, rememberPrompt, runAction, runMachineAction } from '../actions';
import { hubs } from '../hubs/store';
import { prepareUpload } from '../image';
import { toast } from '../toast';
import StatusBadge from './StatusBadge';
import Terminal from './Terminal';
import FilesModal from './FilesModal';
import { agentInfo } from '../agents';

export default function SessionDetail({
  session,
  machine,
}: {
  session: SessionInfo;
  machine: MachineState;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tab, setTab] = useState<'terminal' | 'info'>('terminal');
  const [showKill, setShowKill] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  // ruta elegida en el explorador con "Usar con Claude" (nonce para repetir la misma)
  const [insertReq, setInsertReq] = useState<{ text: string; n: number } | null>(null);
  const offline = !machine.online;

  useEffect(() => {
    const url = `${hubs.baseFor(machine.info.id)}/api/events?machine=${encodeURIComponent(machine.info.id)}&session=${encodeURIComponent(session.id)}&limit=50`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]));
  }, [machine.info.id, session.id, session.lastEventAt]);

  const canStream = session.kind === 'tmux' && !offline;
  const paused = session.status === 'paused';

  async function pauseResume() {
    if (busy) return;
    setBusy(true);
    const res = await runAction(session.globalId, paused ? 'resume' : 'pause');
    setBusy(false);
    toast(res.message ?? (res.ok ? 'listo' : 'error'), res.ok ? 'ok' : 'error');
  }

  return (
    <div className="page-in flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          onClick={() => (location.hash = '#/')}
          className="rounded-xl border border-zinc-700/80 bg-zinc-800/70 px-3.5 py-1.5 text-sm transition active:scale-95 hover:border-zinc-500"
          aria-label="Volver"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1.5 truncate text-base font-bold">
            {session.agent && <span title={agentInfo(session.agent).label}>{agentInfo(session.agent).icon}</span>}
            <span className="truncate">{session.project}</span>
          </h1>
          <p className="truncate text-xs text-zinc-400">
            {machine.info.os === 'darwin' ? '🍎' : machine.info.os === 'linux' ? '🐧' : '💻'}{' '}
            {machine.info.name}
            {offline && ` · offline, visto ${timeAgo(machine.lastSeen)}`}
          </p>
        </div>
        <StatusBadge status={session.status} offline={offline} />
      </header>

      <nav className="flex items-center gap-1 border-b border-zinc-800 px-4 py-2">
        {(['terminal', 'info'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-400'
            }`}
          >
            {t === 'terminal' ? 'Terminal' : 'Info'}
          </button>
        ))}
        {!offline && (
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={() => setShowUpload(true)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 active:scale-95"
              title="archivos de la carpeta de esta sesión (subir, descargar, gestionar)"
            >
              📁
            </button>
            <button
              onClick={pauseResume}
              disabled={busy}
              className={`rounded-lg border px-3 py-1.5 text-sm active:scale-95 disabled:opacity-50 ${
                paused
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-sky-500/40 bg-sky-500/10 text-sky-300'
              }`}
            >
              {paused ? 'Reanudar' : 'Pausar'}
            </button>
            <button
              onClick={() => setShowKill(true)}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 active:scale-95"
            >
              Terminar
            </button>
          </div>
        )}
      </nav>

      {tab === 'terminal' ? (
        <div className="flex min-h-0 flex-1 flex-col bg-[#09090b]">
          {canStream ? (
            <>
              <div className="min-h-0 flex-1 p-2">
                <Terminal globalId={session.globalId} title={session.tmuxSession} />
              </div>
              <TerminalKeys globalId={session.globalId} />
              <PromptComposer
                globalId={session.globalId}
                machineId={machine.info.id}
                paused={paused}
                insert={insertReq}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-400">
              {offline ? (
                <p>La máquina está offline; no hay salida en vivo.</p>
              ) : (
                <div className="max-w-sm space-y-3">
                  <p>
                    Esta sesión corre <b>fuera de tmux</b> (visibilidad limitada): puedes
                    pausarla o terminarla, pero no ver su terminal ni escribirle.
                  </p>
                  <p className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-left text-xs leading-5">
                    <b className="text-zinc-200">Para migrarla a csm:</b> cierra Claude en esa
                    terminal (Ctrl+C dos veces o /exit) y lanza:
                    <br />
                    <code className="break-all text-emerald-300">
                      cd "{session.cwd}" && csm
                    </code>
                    <br />
                    csm detecta la conversación previa y la retoma con{' '}
                    <code className="text-emerald-300">--continue</code>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <dl className="mb-6 space-y-2 text-sm">
            {[
              ['Directorio', session.cwd],
              ['PID', String(session.pid)],
              ['Tipo', session.kind === 'tmux' ? `tmux (${session.tmuxSession})` : 'proceso suelto'],
              ['Tiempo activo', uptime(session.startedAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-28 shrink-0 text-zinc-500">{k}</dt>
                <dd className="break-all font-mono text-xs leading-5 text-zinc-200">{v}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mb-2 text-sm font-semibold text-zinc-300">Actividad reciente</h3>
          {events.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Sin eventos registrados aún. Los eventos aparecen cuando los hooks de Claude Code
              reportan actividad.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 font-mono text-xs text-zinc-500">{timeAgo(e.ts)}</span>
                  <span className="text-zinc-200">{eventLabel(e.kind)}</span>
                  {e.detail && <span className="truncate text-xs text-zinc-500">{e.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showKill && (
        <KillDialog session={session} machineName={machine.info.name} onClose={() => setShowKill(false)} />
      )}
      {showUpload && (
        <FilesModal
          machine={machine}
          initialPath={session.cwd}
          onClose={() => setShowUpload(false)}
          onPick={(p) => setInsertReq({ text: p, n: Date.now() })}
        />
      )}
    </div>
  );
}

// ---- teclado de terminal: diálogos, dígitos y símbolos de programación ----

type Key = { label: string; key: string; wide?: boolean; accent?: 'green' | 'red' };

const ROW_QUICK: Key[] = [
  { label: '1', key: '1' },
  { label: '2', key: '2' },
  { label: '3', key: '3' },
  { label: '↵', key: 'Enter', accent: 'green' },
  { label: '↑', key: 'Up' },
  { label: '↓', key: 'Down' },
  { label: 'Tab', key: 'Tab' },
  { label: '⇧Tab', key: 'BTab' },
  { label: 'Esc', key: 'Escape' },
];

const ROWS_FULL: Key[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((c) => ({ label: c, key: c })),
  ['-', '_', '/', '\\', '|', '~', '`', '.', ',', ';'].map((c) => ({ label: c, key: c })),
  [':', "'", '"', '(', ')', '[', ']', '{', '}', '='].map((c) => ({ label: c, key: c })),
  ['!', '?', '@', '#', '$', '%', '^', '&', '*', '+'].map((c) => ({ label: c, key: c })),
  [
    { label: '<', key: '<' },
    { label: '>', key: '>' },
    { label: '←', key: 'Left' },
    { label: '→', key: 'Right' },
    { label: '↑', key: 'Up' },
    { label: '↓', key: 'Down' },
    { label: 'espacio', key: 'Space', wide: true },
    { label: '⌫ borrar', key: 'BSpace', wide: true },
  ],
  [
    { label: 'Esc', key: 'Escape' },
    { label: 'Tab', key: 'Tab' },
    { label: 'shift-Tab', key: 'BTab', wide: true },
    { label: 'ctrl-C', key: 'C-c', wide: true, accent: 'red' },
    { label: 'ctrl-U', key: 'C-u', wide: true },
    { label: '↵ Enter', key: 'Enter', wide: true, accent: 'green' },
  ],
];

function TerminalKeys({ globalId }: { globalId: string }) {
  const [expanded, setExpanded] = useState(false);

  // fuego directo sin bloquear: el orden lo garantiza el propio WebSocket
  function press(key: string) {
    runAction(globalId, 'send_key', key).then((res) => {
      if (!res.ok) toast(res.message ?? 'No se pudo enviar la tecla', 'error');
    });
  }

  const keyCls = (k: Key) =>
    `select-none whitespace-nowrap rounded-lg border px-1 py-2 text-center font-mono text-xs leading-none active:scale-95 active:bg-zinc-600 ${
      k.accent === 'green'
        ? 'border-emerald-600/50 bg-emerald-900/40 text-emerald-200'
        : k.accent === 'red'
          ? 'border-red-600/50 bg-red-900/40 text-red-200'
          : 'border-zinc-700 bg-zinc-900 text-zinc-300'
    } ${k.wide ? 'col-span-2' : ''}`;

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 px-3 py-2">
      {!expanded ? (
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {ROW_QUICK.map((k) => (
            <button key={k.key} onClick={() => press(k.key)} className={`shrink-0 ${keyCls(k)} px-3`}>
              {k.label}
            </button>
          ))}
          <button
            onClick={() => setExpanded(true)}
            className="ml-auto shrink-0 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 active:scale-95"
            aria-label="Teclado completo"
          >
            ⌨ más
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {ROWS_FULL.map((row, i) => (
            <div key={i} className="grid grid-cols-10 gap-1.5">
              {row.map((k) => (
                <button key={k.key + k.label} onClick={() => press(k.key)} className={keyCls(k)}>
                  {k.label}
                </button>
              ))}
            </div>
          ))}
          <button
            onClick={() => setExpanded(false)}
            className="w-full rounded-lg border border-zinc-600 bg-zinc-800 py-1.5 text-xs text-zinc-300 active:scale-95"
          >
            ⌃ ocultar teclado
          </button>
        </div>
      )}
    </div>
  );
}

// ---- composer de prompts (solo sesiones tmux online) ----

function PromptComposer({
  globalId,
  machineId,
  paused,
  insert,
}: {
  globalId: string;
  machineId: string;
  paused: boolean;
  insert?: { text: string; n: number } | null;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [history, setHistory] = useState(() => promptHistory(globalId));
  const [showHistory, setShowHistory] = useState(false);
  const lastSent = useRef({ text: '', ts: 0 });
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // inserta la ruta elegida en el explorador ("Usar con Claude")
  useEffect(() => {
    if (!insert) return;
    setText((t) => (t.trim() ? t.trimEnd() + '\n' : 'Mira: ') + insert.text);
    toast('📄 ruta insertada — añade tu mensaje y envía');
  }, [insert]);

  // Sube capturas/fotos a la carpeta temporal de la máquina e inserta sus rutas
  // en el mensaje: al enviarlo, Claude abre la ruta y ve la imagen.
  async function attach(list: FileList | null) {
    if (!list || list.length === 0 || attaching) return;
    setAttaching(true);
    const paths: string[] = [];
    for (const f of Array.from(list)) {
      if (f.size > 30 * 1024 * 1024) {
        toast(`${f.name}: supera 30 MB`, 'error');
        continue;
      }
      try {
        // comprime las imágenes en el teléfono: ~10x menos datos y de sobra
        // para que Claude las vea
        const prep = await prepareUpload(f, true);
        const res = await runMachineAction(machineId, 'put_file', {
          path: '::tmp',
          name: prep.name,
          data: prep.dataUrl,
        });
        if (res.ok) paths.push((res.data as { path: string }).path);
        else toast(`${f.name}: ${res.message ?? 'error al subir'}`, 'error');
      } catch {
        toast(`${f.name}: no se pudo leer`, 'error');
      }
    }
    setAttaching(false);
    if (paths.length > 0) {
      setText((t) => (t.trim() ? t.trimEnd() + '\n' : 'Mira: ') + paths.join(' '));
      toast(`📎 ${paths.length === 1 ? 'adjunto listo' : paths.length + ' adjuntos listos'} — añade tu mensaje y envía`);
    }
  }

  async function submit() {
    const t = text.trim();
    if (!t || sending) return;
    if (t === lastSent.current.text && Date.now() - lastSent.current.ts < 5000) {
      toast('Ese prompt se acaba de enviar; espera un momento', 'error');
      return;
    }
    setSending(true);
    const res = await runAction(globalId, 'send_prompt', t);
    setSending(false);
    if (res.ok) {
      lastSent.current = { text: t, ts: Date.now() };
      rememberPrompt(globalId, t);
      setHistory(promptHistory(globalId));
      setText('');
      setShowHistory(false);
      toast('Prompt enviado ✓');
    } else {
      toast(res.message ?? 'No se pudo enviar', 'error');
    }
  }

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
      {paused && (
        <p className="mb-1.5 text-xs text-sky-300">
          La sesión está pausada: reanúdala para que Claude procese lo que envíes.
        </p>
      )}
      {showHistory && history.length > 0 && (
        <div className="mb-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-2">
          {history.map((h, i) => (
            <button
              key={i}
              onClick={() => {
                setText(h);
                setShowHistory(false);
              }}
              className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
            >
              {h}
            </button>
          ))}
        </div>
      )}
      {showAttach && (
        <div className="mb-2 flex gap-2">
          <button
            onClick={() => {
              setShowAttach(false);
              imageInput.current?.click();
            }}
            className="flex-1 rounded-xl border border-emerald-700/50 bg-emerald-950/40 px-3 py-2.5 text-sm font-semibold text-emerald-300 active:scale-[0.98]"
          >
            🖼 Foto o captura
          </button>
          <button
            onClick={() => {
              setShowAttach(false);
              fileInput.current?.click();
            }}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-200 active:scale-[0.98]"
          >
            📄 Archivo
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => setShowAttach((v) => !v)}
          disabled={attaching}
          className="rounded-xl border border-zinc-700 px-3 py-2.5 text-sm text-zinc-400 active:scale-95 disabled:opacity-40"
          aria-label="Adjuntar imagen o archivo para Claude"
          title="Adjuntar imagen o archivo para Claude"
        >
          {attaching ? '⏳' : '📎'}
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          disabled={history.length === 0}
          className="rounded-xl border border-zinc-700 px-3 py-2.5 text-sm text-zinc-400 active:scale-95 disabled:opacity-40"
          aria-label="Historial de prompts"
          title="Historial de prompts"
        >
          🕘
        </button>
        <button
          onClick={async () => {
            const res = await runAction(globalId, 'send_key', 'Tab');
            if (!res.ok) toast(res.message ?? 'No se pudo enviar Tab', 'error');
          }}
          className="rounded-xl border border-zinc-700 px-3 py-2.5 font-mono text-sm text-zinc-300 active:scale-95 active:bg-zinc-700"
          aria-label="Enviar tecla Tab"
          title="Enviar tecla Tab"
        >
          ⇥
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => {
            // con el teclado del teléfono abierto, asegura que el campo quede visible
            const el = e.target;
            setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 250);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="Escríbele a Claude…"
          rows={text.includes('\n') || text.length > 60 ? 3 : 1}
          className="min-w-0 flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500/60"
        />
        <button
          onClick={submit}
          disabled={sending || !text.trim()}
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-40"
        >
          {sending ? '…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}

// ---- confirmación de terminar (con escalada a SIGKILL) ----

function KillDialog({
  session,
  machineName,
  onClose,
}: {
  session: SessionInfo;
  machineName: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'confirm' | 'waiting' | 'stubborn'>('confirm');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (phase !== 'waiting') return;
    // si la sesión muere, el detalle entero se desmonta y este diálogo desaparece;
    // si sigue viva tras 6 s, ofrece forzar
    const t = setTimeout(() => setPhase('stubborn'), 6000);
    return () => clearTimeout(t);
  }, [phase]);

  async function kill(force: boolean) {
    if (busy) return;
    setBusy(true);
    const res = await runAction(session.globalId, force ? 'force_kill' : 'kill');
    setBusy(false);
    if (res.ok) {
      toast(force ? 'SIGKILL enviado' : 'Terminando sesión…');
      if (force) onClose();
      else setPhase('waiting');
    } else {
      toast(res.message ?? 'No se pudo terminar', 'error');
    }
  }

  return (
    <div className="backdrop-in fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div className="modal-in w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
        {phase === 'confirm' && (
          <>
            <h2 className="mb-2 text-base font-bold text-red-300">Terminar sesión</h2>
            <p className="mb-4 text-sm leading-6 text-zinc-300">
              Vas a terminar <b className="text-white">{session.project}</b>
              {session.tmuxSession && (
                <span className="text-zinc-400"> ({session.tmuxSession})</span>
              )}{' '}
              en la máquina <b className="text-white">{machineName}</b>. Claude recibirá SIGTERM
              y la conversación quedará guardada (puedes retomarla con{' '}
              <code className="text-emerald-300">csm</code>).
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm active:scale-95"
              >
                Cancelar
              </button>
              <button
                onClick={() => kill(false)}
                disabled={busy}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
              >
                Terminar
              </button>
            </div>
          </>
        )}
        {phase === 'waiting' && (
          <p className="py-2 text-center text-sm text-zinc-300">
            SIGTERM enviado, esperando a que la sesión termine…
          </p>
        )}
        {phase === 'stubborn' && (
          <>
            <p className="mb-4 text-sm leading-6 text-zinc-300">
              La sesión <b className="text-white">{session.project}</b> sigue viva tras varios
              segundos. ¿Forzar con SIGKILL? (terminación inmediata, sin limpieza)
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm active:scale-95"
              >
                Dejarla
              </button>
              <button
                onClick={() => kill(true)}
                disabled={busy}
                className="flex-1 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
              >
                Forzar (SIGKILL)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
