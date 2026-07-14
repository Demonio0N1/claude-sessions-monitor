import fs from 'node:fs';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { WebSocket } from 'ws';
import { BIN_DIR, PORT, TOKEN, WEB_DIST } from './config.js';
import * as state from './state.js';
import * as db from './db.js';
import { installScript } from './install-sh.js';
import type { AgentMsg, AppMsg } from './types.js';

const app = Fastify({ logger: { level: 'warn' } });

await app.register(websocket);

// ---- WebSocket: agentes ----
app.get('/ws/agent', { websocket: true }, (socket: WebSocket) => {
  let machineId: string | null = null;
  let lastMsg = Date.now();

  socket.on('message', (raw: Buffer) => {
    lastMsg = Date.now();
    let msg: AgentMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!machineId) {
      if (msg.type === 'hello' && msg.token === TOKEN && msg.machine?.id) {
        machineId = msg.machine.id;
        state.agentConnected(msg.machine, socket);
        socket.send(JSON.stringify({ type: 'hello_ok' }));
      } else {
        socket.send(JSON.stringify({ type: 'error', message: 'token inválido' }));
        socket.close();
      }
      return;
    }
    state.touch(machineId);
    switch (msg.type) {
      case 'sessions':
        state.updateSessions(machineId, msg.sessions ?? []);
        break;
      case 'output':
        state.onOutput(machineId, msg.sessionId, msg.data, !!msg.full);
        break;
      case 'event':
        state.onEvent(machineId, msg.sessionId, msg.cwd, msg.event);
        break;
      case 'pong':
        break;
    }
  });

  const heartbeat = setInterval(() => {
    if (Date.now() - lastMsg > 60_000) {
      socket.terminate();
    } else if (socket.readyState === socket.OPEN) {
      socket.send('{"type":"ping"}');
    }
  }, 20_000);

  socket.on('close', () => {
    clearInterval(heartbeat);
    if (machineId) state.agentDisconnected(machineId, socket);
  });
  socket.on('error', () => socket.terminate());
});

// ---- WebSocket: apps (navegador) ----
app.get('/ws/app', { websocket: true }, (socket: WebSocket) => {
  state.appConnected(socket);
  socket.on('message', (raw: Buffer) => {
    let msg: AppMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'subscribe') state.appSubscribe(socket, msg.sessionId);
    else if (msg.type === 'unsubscribe') state.appUnsubscribe(socket, msg.sessionId);
  });
  socket.on('close', () => state.appDisconnected(socket));
  socket.on('error', () => socket.terminate());
});

// ---- REST ----
app.get('/api/state', async () => ({ machines: state.snapshot() }));

app.get<{ Querystring: { machine?: string; session?: string; limit?: string } }>(
  '/api/events',
  async (req) => {
    const { machine = '', session = '', limit = '100' } = req.query;
    return { events: db.listEvents(machine, session, Math.min(Number(limit) || 100, 500)) };
  },
);

app.delete<{ Params: { id: string } }>('/api/machines/:id', async (req, reply) => {
  if (state.forgetMachine(req.params.id)) return { ok: true };
  reply.code(409).send({ error: 'la máquina no existe o sigue online' });
});

app.get('/install.sh', async (req, reply) => {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
  const base = `${proto}://${req.headers.host}`;
  reply.type('text/x-sh').send(installScript(base, TOKEN));
});

// Binarios del agente + lanzador csm
fs.mkdirSync(BIN_DIR, { recursive: true });
await app.register(fastifyStatic, { root: BIN_DIR, prefix: '/bin/' });

// Web app compilada (producción). En desarrollo se usa `vite dev` con proxy.
if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    decorateReply: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws') || req.url.startsWith('/bin')) {
      reply.code(404).send({ error: 'not found' });
    } else {
      reply.type('text/html').send(fs.readFileSync(`${WEB_DIST}/index.html`));
    }
  });
}

state.loadPersisted();

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`[csm-hub] escuchando en http://0.0.0.0:${PORT}`);
console.log(`[csm-hub] token de agentes: ${TOKEN}`);
console.log(`[csm-hub] instalador: curl -fsSL http://<esta-máquina>:${PORT}/install.sh | sh`);
