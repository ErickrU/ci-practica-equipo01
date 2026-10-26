/* ==========================================================================
   Calculadora de Varillas · Service Worker
   --------------------------------------------------------------------------
   La app es 100 % cliente (no consume APIs), así que basta con precachear el
   app shell y servirlo desde caché:

     navegación         -> network-first -> cache(index.html) -> offline.html
     app shell (css/js/iconos/manifest)
                        -> cache-first + revalidación en segundo plano
     resto same-origin  -> network con respaldo de caché

   Además implementa los Edge PWA Widgets (Windows 11): eventos widgetinstall /
   widgetresume / widgetclick y self.widgets.updateByTag, todo protegido con
   `'widgets' in self`. El simulador de la página usa el MISMO código a través
   de mensajes WIDGET_DATOS / WIDGET_ACCION (ver bloque WIDGETS al final).

   Sube VERSION para invalidar los caches viejos en el siguiente despliegue.
   ========================================================================== */

const VERSION = 'v4';
const CACHE_SHELL = `calculadora-varillas-shell-${VERSION}`;
/** Estado de los widgets (último cálculo publicado por la página); sobrevive a VERSION. */
const CACHE_WIDGETS = 'calculadora-varillas-widgets-v1';

/** App shell: lo mínimo para que la app abra y calcule sin red. */
const PRECACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './css/estilos.css',
  './js/app.js',
  './js/calculo.js',
  './js/registro-sw.js',
  './js/widgets.js',
  './widgets/ultimo-calculo-plantilla.json',
  './widgets/ultimo-calculo-datos.json',
  './widgets/ultimo-calculo-captura.png',
  './iconos/favicon.svg',
  './iconos/icono-192.png',
  './iconos/icono-512.png',
  './iconos/icono-maskable-512.png',
  './iconos/apple-touch-icon.png',
];

const absoluta = (ruta) => new URL(ruta, self.registration.scope).toString();

/* ==========================================================================
   INSTALL · precache tolerante a fallos
   ========================================================================== */
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);

      // addAll falla en bloque si un solo recurso da error; lo hacemos uno a uno
      // para que un archivo ausente no impida instalar el service worker.
      const resultados = await Promise.allSettled(
        PRECACHE.map(async (ruta) => {
          const peticion = new Request(absoluta(ruta), { cache: 'reload' });
          const respuesta = await fetch(peticion);
          if (!respuesta.ok) throw new Error(`${ruta} -> ${respuesta.status}`);
          await cache.put(peticion, respuesta);
        }),
      );

      const fallos = resultados.filter((r) => r.status === 'rejected');
      if (fallos.length > 0) {
        console.warn('[SW] recursos no precacheados:', fallos.map((f) => f.reason?.message));
      }
    })(),
  );
});

/* ==========================================================================
   ACTIVATE · limpieza de caches antiguos
   ========================================================================== */
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((nombre) => nombre.startsWith('calculadora-varillas-') && nombre !== CACHE_SHELL && nombre !== CACHE_WIDGETS)
          .map((nombre) => caches.delete(nombre)),
      );

      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch { /* opcional */ }
      }

      await self.clients.claim();

      // Windows 11: vuelve a pintar los widgets ya instalados con la versión nueva.
      if ('widgets' in self) {
        try { await updateWidgets(); } catch (error) { console.warn('[SW] widgets', error); }
      }
    })(),
  );
});

/* ==========================================================================
   MESSAGE · activar la versión nueva y contrato de widgets con la página
   ========================================================================== */
self.addEventListener('message', (evento) => {
  const mensaje = evento.data;
  if (!mensaje || typeof mensaje !== 'object') return;

  if (mensaje.tipo === 'SALTAR_ESPERA') {
    self.skipWaiting();
    return;
  }

  if (mensaje.tipo === 'WIDGET_DATOS' || mensaje.tipo === 'WIDGET_ACCION') {
    const { tag } = mensaje;
    // Solo atendemos el widget de esta app; cualquier otro tag se ignora.
    if (typeof tag !== 'string' || !TAG_VALIDO.test(tag) || tag !== TAG_WIDGET) return;
    if (mensaje.tipo === 'WIDGET_DATOS') evento.waitUntil(recibirDatosWidget(tag, mensaje.datos));
    else evento.waitUntil(manejarAccionWidget(tag, String(mensaje.verb ?? '')));
  }
});

/* ==========================================================================
   Helpers
   ========================================================================== */

/** Guarda en caché solo respuestas útiles (200 y no opacas). */
const esGuardable = (respuesta) => respuesta && respuesta.ok && respuesta.type !== 'opaque';

/* --------------------------- cache-first -------------------------------- */
async function cachePrimero(peticion) {
  const cache = await caches.open(CACHE_SHELL);
  const guardada = await cache.match(peticion);

  if (guardada) {
    // Revalidamos en segundo plano para la próxima visita.
    fetch(peticion)
      .then((respuesta) => { if (esGuardable(respuesta)) cache.put(peticion, respuesta); })
      .catch(() => {});
    return guardada;
  }

  const respuesta = await fetch(peticion);
  if (esGuardable(respuesta)) cache.put(peticion, respuesta.clone());
  return respuesta;
}

/* --------------------------- network-first ------------------------------ */
async function redPrimero(peticion) {
  const cache = await caches.open(CACHE_SHELL);
  try {
    const respuesta = await fetch(peticion);
    if (esGuardable(respuesta)) cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(peticion);
    if (guardada) return guardada;
    throw error;
  }
}

/* --------------------------- navegación --------------------------------- */
async function navegacion(evento) {
  const cache = await caches.open(CACHE_SHELL);
  try {
    const respuesta = (await evento.preloadResponse) || (await fetch(evento.request));
    if (esGuardable(respuesta)) cache.put(evento.request, respuesta.clone());
    return respuesta;
  } catch {
    return (
      (await cache.match(evento.request)) ||
      (await cache.match(absoluta('./index.html'))) ||
      (await cache.match(absoluta('./'))) ||
      (await cache.match(absoluta('./offline.html'))) ||
      new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    );
  }
}

/* ==========================================================================
   FETCH · enrutado
   ========================================================================== */
self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  // Solo GET: nada más se cachea.
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Dejamos pasar lo que no es de nuestro origen.
  if (url.origin !== self.location.origin) return;

  // 1. Navegaciones
  if (peticion.mode === 'navigate') {
    evento.respondWith(navegacion(evento));
    return;
  }

  // 2. App shell
  if (/\.(?:css|js|mjs|svg|png|webp|woff2?|webmanifest)$/.test(url.pathname)) {
    evento.respondWith(cachePrimero(peticion));
    return;
  }

  // 3. Resto: red con respaldo de caché.
  evento.respondWith(redPrimero(peticion));
});

/* ==========================================================================
   WIDGETS · Edge PWA Widgets (Windows 11) y simulador del panel
   --------------------------------------------------------------------------
   Contrato con la página (ver js/widgets.js):
     página → SW  { tipo: 'WIDGET_DATOS', tag, datos }  publica el último cálculo
     página → SW  { tipo: 'WIDGET_DATOS', tag }         consulta los datos vigentes
     página → SW  { tipo: 'WIDGET_ACCION', tag, verb }  Action.Execute del simulador
     SW → página  { tipo: 'WIDGET_ACTUALIZADO', tag, datos }
   El SW no puede leer localStorage: guarda los datos en memoria y en
   CACHE_WIDGETS (Response sintética) para sobrevivir a sus reinicios.
   ========================================================================== */
const TAG_WIDGET = 'ultimo-calculo';
const TAG_VALIDO = /^[a-z0-9-]+$/;
const datosWidgets = new Map();
const claveEstado = (tag) => absoluta(`./widgets/${tag}-estado.json`);
const esObjetoPlano = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);

/** Datos tal como los recibe Windows: `urlApp` absoluta respecto al scope. */
const datosParaHost = (datos) => JSON.stringify({ ...datos, urlApp: absoluta(datos.urlApp ?? './') });

async function guardarDatosWidget(tag, datos) {
  datosWidgets.set(tag, datos);
  try {
    const cache = await caches.open(CACHE_WIDGETS);
    await cache.put(
      claveEstado(tag),
      new Response(JSON.stringify(datos), { headers: { 'Content-Type': 'application/json' } }),
    );
  } catch (error) {
    console.warn('[SW] no se pudo guardar el estado del widget', error);
  }
}

async function leerDatosGuardados(tag) {
  if (datosWidgets.has(tag)) return datosWidgets.get(tag);
  try {
    const guardada = await caches.match(claveEstado(tag));
    if (guardada) {
      const datos = await guardada.json();
      datosWidgets.set(tag, datos);
      return datos;
    }
  } catch { /* sin estado previo */ }
  return null;
}

/** JSON estático del manifest (`data`), desde el app shell o la red. */
async function obtenerDatosEstaticos(tag, urlDatos = `./widgets/${tag}-datos.json`) {
  const url = absoluta(urlDatos);
  const respuesta = (await caches.match(url)) || (await fetch(url));
  if (!respuesta.ok) throw new Error(`${url} -> ${respuesta.status}`);
  return respuesta.json();
}

/** Último cálculo publicado por la página; si no hay, los valores de ejemplo. */
async function obtenerDatosWidget(tag, urlDatos) {
  return (await leerDatosGuardados(tag)) ?? obtenerDatosEstaticos(tag, urlDatos);
}

async function obtenerPlantillaWidget(urlPlantilla = `./widgets/${TAG_WIDGET}-plantilla.json`) {
  const url = absoluta(urlPlantilla);
  const respuesta = (await caches.match(url)) || (await fetch(url));
  if (!respuesta.ok) throw new Error(`${url} -> ${respuesta.status}`);
  return respuesta.text();
}

/** Actualiza el widget del sistema (si existe) y avisa a todas las ventanas. */
async function difundirWidget(tag, datos) {
  if ('widgets' in self) {
    try {
      await self.widgets.updateByTag(tag, { template: await obtenerPlantillaWidget(), data: datosParaHost(datos) });
    } catch (error) {
      console.warn('[SW] updateByTag', error); // el widget puede no estar instalado en el host
    }
  }
  const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const cliente of clientes) cliente.postMessage({ tipo: 'WIDGET_ACTUALIZADO', tag, datos });
}

/** WIDGET_DATOS: con `datos` publica y guarda; sin ellos solo consulta. */
async function recibirDatosWidget(tag, datos) {
  if (esObjetoPlano(datos)) {
    await guardarDatosWidget(tag, datos);
    await difundirWidget(tag, datos);
  } else {
    await difundirWidget(tag, await obtenerDatosWidget(tag));
  }
}

/**
 * Única ruta para las acciones del widget: la usan tanto `widgetclick`
 * (Windows) como WIDGET_ACCION (simulador). La calculadora no tiene acciones
 * con estado (su plantilla solo abre la app), así que todo verbo es desconocido.
 */
async function manejarAccionWidget(tag, verb) {
  console.warn(`[SW] verbo de widget desconocido para ${tag}: ${verb}`);
}

/** Pinta un widget instalado en Windows con su plantilla y sus datos. */
async function renderWidget(widget) {
  const { tag, msAcTemplate, data } = widget.definition;
  const template = await (await fetch(msAcTemplate)).text();
  const datos = await obtenerDatosWidget(tag, data);
  await self.widgets.updateByTag(tag, { template, data: datosParaHost(datos) });
}

async function updateWidgets() {
  const widget = await self.widgets.getByTag(TAG_WIDGET);
  if (widget) await renderWidget(widget);
}

if ('widgets' in self) {
  self.addEventListener('widgetinstall', (evento) => evento.waitUntil(renderWidget(evento.widget)));
  self.addEventListener('widgetresume', (evento) => evento.waitUntil(renderWidget(evento.widget)));
  self.addEventListener('widgetclick', (evento) => evento.waitUntil(manejarAccionWidget(TAG_WIDGET, evento.action)));
}
