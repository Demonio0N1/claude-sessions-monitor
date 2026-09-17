import fs from 'node:fs';
import os from 'node:os';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import type { FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { BIN_DIR, PORT, TOKEN, WEB_DIST } from './config.js';
import * as state from './state.js';
import * as db from './db.js';
import { installScript } from './install-sh.js';
import { discoverHubs, reportHubs } from './discovery.js';
import { requireTokenHook, tokenFromRequest, tokenOk } from './auth.js';
import type { AgentMsg, AppMsg } from './types.js';

const app = Fastify({ logger: { level: 'warn' } });

// La app Android (origen http://localhost) y la PWA de un hub consultando a otro
// hacen peticiones cross-origin; la autenticación es el token del hub, no el origen.
await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'] });
// Emparejamiento: /api/* (salvo /api/ping) e /install.sh exigen el token del hub.
app.addHook('onRequest', requireTokenHook);

// maxPayload amplio: la subida de archivos (put_file) viaja en base64 por el WS.
// perMessageDeflate: el grueso del tráfico es texto de terminal y JSON repetitivo,
// que comprime ~10x — clave para usar la app con datos móviles.
await app.register(websocket, {
  options: {
    maxPayload: 64 * 1024 * 1024,
    perMessageDeflate: { threshold: 512 },
  },
});

// ---- WebSocket: agentes ----
app.get('/ws/agent', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
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
        // los hubs a los que reporta este agente: así este hub descubre a los demás
        reportHubs(machineId, msg.hubs ?? [], req.ip);
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
      case 'action_result':
        state.resolveAction(msg.requestId, msg.ok, msg.message, msg.data);
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

// ---- WebSocket: apps (navegador / APK) ----
// El navegador no puede mandar cabeceras en el handshake: el token va en ?token=.
// 4401 = "token inválido": la app deja de reintentar hasta que el usuario lo corrija.
app.get('/ws/app', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
  if (!tokenOk(tokenFromRequest(req))) {
    socket.close(4401, 'token inválido');
    return;
  }
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
    else if (msg.type === 'action' && msg.requestId && msg.sessionId)
      state.dispatchAction(socket, msg.requestId, msg.sessionId, msg.action, msg.text);
    else if (msg.type === 'machine_action' && msg.requestId && msg.machineId)
      state.dispatchMachineAction(
        socket,
        msg.requestId,
        msg.machineId,
        msg.action,
        msg.path,
        msg.fresh,
        msg.name,
        msg.data,
        msg.agent,
        msg.gateway,
      );
  });
  socket.on('close', () => state.appDisconnected(socket));
  socket.on('error', () => socket.terminate());
});

// ---- REST ----
// Público: identifica un hub de csm (descubrimiento entre hubs y validación de
// URL en la app) sin revelar nada. Todo lo demás bajo /api exige el token.
app.get('/api/ping', async () => ({ csm: true, name: os.hostname().replace(/\.local$/, ''), port: PORT }));

app.get('/api/state', async () => ({ machines: state.snapshot() }));

// Paneles activos en la tailnet (este hub + pares del mismo usuario que responden
// como hub): la app los usa para conectarse a todos y mostrar un solo panel.
app.get('/api/hubs', async (req) => {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
  return { hubs: await discoverHubs(`${proto}://${req.headers.host}`) };
});

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
console.log(`[csm-hub] token del hub (agentes y app): ${TOKEN}`);
console.log(`[csm-hub] panel con acceso: http://<esta-máquina>:${PORT}/#t=${TOKEN}`);
console.log(`[csm-hub] instalador: curl -fsSL "http://<esta-máquina>:${PORT}/install.sh?t=${TOKEN}" | sh`);
