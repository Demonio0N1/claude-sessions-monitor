import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TOKEN } from './config.js';

/** Compara en tiempo constante contra el token del hub (data/token.txt). */
export function tokenOk(t: unknown): boolean {
  if (typeof t !== 'string' || !t) return false;
  const a = Buffer.from(t);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `Authorization: Bearer <token>` o, para WebSocket/curl, `?token=` / `?t=`. */
export function tokenFromRequest(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const q = req.query as Record<string, unknown> | undefined;
  const t = q?.token ?? q?.t;
  return typeof t === 'string' ? t : undefined;
}

function needsToken(url: string): boolean {
  const p = url.split('?')[0];
  return (p.startsWith('/api/') && p !== '/api/ping') || p === '/install.sh';
}

/**
 * Hook onRequest: todo /api/* (salvo /api/ping, que identifica el hub sin
 * credenciales) y /install.sh (lleva el token embebido) exigen el token. La web
 * (/), los binarios (/bin/*) y el APK son públicos: no contienen secretos.
 */
export async function requireTokenHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!needsToken(req.url) || tokenOk(tokenFromRequest(req))) return;
  return reply
    .code(401)
    .send({ error: 'token requerido', hint: 'Authorization: Bearer <token del hub> o ?t=<token> (ver ./scripts/hub-service.sh status)' });
}
