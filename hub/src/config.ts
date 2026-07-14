import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HUB_ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.CSM_DATA_DIR ?? path.join(HUB_ROOT, 'data');
export const BIN_DIR = path.join(HUB_ROOT, 'public', 'bin');
export const WEB_DIST = path.resolve(HUB_ROOT, '..', 'web', 'dist');
export const PORT = Number(process.env.CSM_PORT ?? 4000);

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadToken(): string {
  if (process.env.CSM_TOKEN) return process.env.CSM_TOKEN;
  const file = path.join(DATA_DIR, 'token.txt');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}

export const TOKEN = loadToken();
