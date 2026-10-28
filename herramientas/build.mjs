/**
 * Etapa Build: genera la versión distribuible de la PWA en `artefactos/`.
 *
 * La aplicación no se compila ni se empaqueta con un bundler, así que el build
 * consiste en copiar únicamente los archivos que un servidor web necesita
 * publicar (el mismo conjunto que precachea el service worker), dejando fuera
 * el código fuente auxiliar: pruebas, herramientas, documentación y plantillas
 * de GitHub. Además escribe `BUILD-INFO.json` con la versión, el commit y el
 * número de ejecución para que cualquier artefacto sea trazable a su origen.
 *
 * Uso:  npm run build   →   node herramientas/build.mjs [--salida artefactos]
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const flag = (nombre, porDefecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
};
const SALIDA = resolve(RAIZ, flag('salida', 'artefactos'));

/** Allowlist de lo que se distribuye. Todo lo demás se queda en el repositorio. */
const DISTRIBUIBLES = [
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'iconos',
  'widgets',
];

if (SALIDA === RAIZ || !SALIDA.startsWith(RAIZ)) {
  console.error(`La salida debe estar dentro del proyecto: ${SALIDA}`);
  process.exit(1);
}

rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });

for (const entrada of DISTRIBUIBLES) {
  cpSync(join(RAIZ, entrada), join(SALIDA, entrada), { recursive: true });
}

const paquete = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
const git = (cmd) => {
  try { return execSync(cmd, { cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
};

const info = {
  nombre: paquete.name,
  version: paquete.version,
  commit: process.env.GITHUB_SHA ?? git('git rev-parse HEAD'),
  rama: process.env.GITHUB_REF_NAME ?? git('git rev-parse --abbrev-ref HEAD'),
  ejecucion: process.env.GITHUB_RUN_NUMBER ? Number(process.env.GITHUB_RUN_NUMBER) : null,
  generadoPor: process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'local',
  fecha: new Date().toISOString(),
  node: process.version,
};
writeFileSync(join(SALIDA, 'BUILD-INFO.json'), JSON.stringify(info, null, 2) + '\n');

// Resumen legible para el log del pipeline.
const archivos = [];
const recorrer = (dir, prefijo = '') => {
  for (const nombre of execSync('ls -1A', { cwd: dir }).toString().trim().split('\n')) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) recorrer(ruta, `${prefijo}${nombre}/`);
    else archivos.push({ ruta: `${prefijo}${nombre}`, bytes: statSync(ruta).size });
  }
};
recorrer(SALIDA);
const total = archivos.reduce((s, a) => s + a.bytes, 0);

console.log(`Build de ${info.nombre} v${info.version} (${info.commit?.slice(0, 7) ?? 'sin git'}) → ${SALIDA}`);
for (const a of archivos) console.log(`  ${String(a.bytes).padStart(7)}  ${a.ruta}`);
console.log(`  ${archivos.length} archivos, ${(total / 1024).toFixed(1)} KiB en total`);
