// Genera los iconos PNG de la PWA sin dependencias (encoder PNG a mano).
// Diseño: cuadrado redondeado oscuro con 3 barras (verde/ámbar/gris) = lista de sesiones.
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [24, 24, 27];
const BARS = [
  { y0: 0.24, y1: 0.35, x0: 0.19, x1: 0.62, c: [52, 211, 153] },  // verde
  { y0: 0.44, y1: 0.55, x0: 0.19, x1: 0.81, c: [251, 191, 36] },  // ámbar
  { y0: 0.64, y1: 0.75, x0: 0.19, x1: 0.5, c: [113, 113, 122] },  // gris
];

function makeIcon(size) {
  const r = size * 0.22; // radio de las esquinas
  return png(size, (x, y) => {
    // máscara de cuadrado redondeado
    const dx = Math.max(r - x, x - (size - 1 - r), 0);
    const dy = Math.max(r - y, y - (size - 1 - r), 0);
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
    for (const b of BARS) {
      const bx0 = b.x0 * size, bx1 = b.x1 * size, by0 = b.y0 * size, by1 = b.y1 * size;
      const br = (by1 - by0) / 2;
      const cx = Math.min(Math.max(x, bx0 + br), bx1 - br);
      const cy = (by0 + by1) / 2;
      if (Math.hypot(x - cx, y - cy) <= br || (x >= bx0 + br && x <= bx1 - br && y >= by0 && y <= by1)) {
        return [...b.c, 255];
      }
    }
    return [...BG, 255];
  });
}

for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makeIcon(size));
  console.log(`icon-${size}.png`);
}

// Fuente para los íconos de la app Android (@capacitor/assets pide 1024 px).
const assetsDir = path.join(outDir, '..', '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
const big = makeIcon(1024);
for (const name of ['icon.png', 'icon-only.png']) {
  fs.writeFileSync(path.join(assetsDir, name), big);
  console.log(`assets/${name}`);
}
