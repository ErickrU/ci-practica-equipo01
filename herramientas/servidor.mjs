/**
 * Servidor estático de desarrollo, sin dependencias.
 * Sirve la raíz del proyecto con los tipos MIME correctos (incluido
 * .webmanifest) y sin caché HTTP, para que el service worker se actualice
 * en cada recarga mientras se desarrolla.
 *
 * Uso:  node herramientas/servidor.mjs [--puerto 8080]
 *
 * Para producción basta cualquier hosting estático con HTTPS
 * (GitHub Pages, Netlify, S3 + CloudFront, etc.).
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const flag = (nombre, porDefecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
};
const PUERTO = Number(flag('puerto', process.env.PORT ?? 8080));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function responderTexto(res, codigo, texto) {
  res.writeHead(codigo, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(texto);
}

const servidor = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    responderTexto(res, 405, 'Método no permitido');
    return;
  }

  let ruta;
  try {
    ruta = decodeURIComponent(new URL(req.url, `http://${req.headers.host ?? 'localhost'}`).pathname);
  } catch {
    responderTexto(res, 400, 'URL inválida');
    return;
  }
  if (ruta.endsWith('/')) ruta += 'index.html';

  // Nunca salimos de la raíz del proyecto.
  const archivo = resolve(join(RAIZ, ruta));
  if (archivo !== RAIZ && !archivo.startsWith(RAIZ + sep)) {
    responderTexto(res, 403, 'Prohibido');
    return;
  }

  try {
    const info = await stat(archivo);
    if (!info.isFile()) throw new Error('no es un archivo');

    res.writeHead(200, {
      'Content-Type': MIME[extname(archivo).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(archivo).pipe(res);
  } catch {
    responderTexto(res, 404, `No encontrado: ${ruta}`);
  }
});

// Solo escucha en loopback: es un servidor de desarrollo, no debe quedar
// accesible desde otras máquinas de la red.
servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`Calculadora de Varillas → http://localhost:${PUERTO}/`);
  console.log(`Sirviendo ${RAIZ}  (Ctrl+C para detener)`);
});
