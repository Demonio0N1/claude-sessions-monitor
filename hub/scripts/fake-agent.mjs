// Agente falso para validar la tubería agente → hub → UI sin tocar máquinas reales.
// Uso: node scripts/fake-agent.mjs [hubUrl] (token: env CSM_TOKEN o hub/data/token.txt)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hubUrl = process.argv[2] ?? 'ws://127.0.0.1:4000/ws/agent';
const token =
  process.env.CSM_TOKEN ??
  fs.readFileSync(path.join(__dirname, '..', 'data', 'token.txt'), 'utf8').trim();

const machine = { id: 'fake-1', name: 'servidor-fake', os: 'linux', arch: 'amd64', version: '0.0.0-fake' };

const now = Date.now();
const sessions = [
  { id: 'tmux:%1', kind: 'tmux', tmuxSession: 'csm-webapp', pid: 1001, cwd: '/home/gary/proyectos/webapp', project: 'webapp', startedAt: now - 3600_000, status: 'active' },
  { id: 'tmux:%2', kind: 'tmux', tmuxSession: 'csm-api', pid: 1002, cwd: '/home/gary/proyectos/api', project: 'api', startedAt: now - 7200_000, status: 'waiting_input' },
  { id: 'pid:1003', kind: 'process', pid: 1003, cwd: '/home/gary/proyectos/scraper', project: 'scraper', startedAt: now - 600_000, status: 'idle' },
];

const STATUSES = ['active', 'waiting_input', 'idle'];
const subscribed = new Set();
let counter = 0;

function connect() {
  const ws = new WebSocket(hubUrl);
  ws.on('open', () => {
    console.log('[fake-agent] conectado');
    ws.send(JSON.stringify({ type: 'hello', token, machine }));
    ws.send(JSON.stringify({ type: 'sessions', sessions }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'ping') ws.send('{"type":"pong"}');
    if (msg.type === 'subscribe') subscribed.add(msg.sessionId);
    if (msg.type === 'unsubscribe') subscribed.delete(msg.sessionId);
  });
  ws.on('close', () => {
    console.log('[fake-agent] desconectado, reintento en 2s');
    setTimeout(connect, 2000);
  });
  ws.on('error', (e) => console.error('[fake-agent]', e.message));

  const rotate = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return clearInterval(rotate);
    // rota el estado de la primera sesión para ver cambios en vivo en la UI
    sessions[0].status = STATUSES[(STATUSES.indexOf(sessions[0].status) + 1) % STATUSES.length];
    sessions[0].lastEvent = sessions[0].status === 'waiting_input' ? 'Stop' : 'UserPromptSubmit';
    sessions[0].lastEventAt = Date.now();
    ws.send(JSON.stringify({ type: 'sessions', sessions }));
    ws.send(JSON.stringify({
      type: 'event', sessionId: sessions[0].id, cwd: sessions[0].cwd,
      event: { kind: sessions[0].lastEvent, ts: Date.now(), detail: 'evento simulado' },
    }));
  }, 5000);

  const output = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return clearInterval(output);
    counter++;
    for (const sid of subscribed) {
      const lines = [
        `\x1b[1;36m● Claude Code (simulado)\x1b[0m — tick ${counter}`,
        '',
        `\x1b[32m✓\x1b[0m Editando src/app.ts ...`,
        `\x1b[33m⏳\x1b[0m Ejecutando tests (${counter % 40}/40)`,
        '',
        `\x1b[90m${new Date().toLocaleTimeString()}\x1b[0m`,
      ];
      ws.send(JSON.stringify({ type: 'output', sessionId: sid, data: lines.join('\n'), full: true }));
    }
  }, 1000);
}

connect();
