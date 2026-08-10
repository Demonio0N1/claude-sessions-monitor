/** Compresión de imágenes en el navegador antes de subirlas: una foto de
 *  cámara (5–10 MB) se convierte en un JPEG de ~2000px (~0.5 MB) sin pérdida
 *  visible para el uso real (que Claude la vea, revisarla en el panel). */

const MAX_DIM = 2000;
const QUALITY = 0.85;
/** por debajo de esto no vale la pena recomprimir */
const MIN_BYTES = 400 * 1024;

export interface Prepared {
  name: string;
  dataUrl: string;
}

export async function prepareUpload(file: File, compressImages: boolean): Promise<Prepared> {
  if (compressImages && file.type.startsWith('image/') && file.type !== 'image/gif' && file.size > MIN_BYTES) {
    try {
      const small = await compress(file);
      // solo usa la versión comprimida si de verdad ahorra
      if (small.length < file.size * 0.9) {
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        return { name, dataUrl: small };
      }
    } catch {
      /* formato que el navegador no decodifica: sube el original */
    }
  }
  return { name: file.name, dataUrl: await readAsDataURL(file) };
}

function readAsDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

async function compress(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sin canvas 2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', QUALITY);
  } finally {
    bmp.close();
  }
}
