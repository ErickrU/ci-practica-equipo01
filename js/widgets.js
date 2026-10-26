/**
 * Panel de widgets · módulo compartido por las tres PWA del curso
 * ---------------------------------------------------------------------------
 * 1. Resolvedor de expresiones `${...}` al estilo de las plantillas de
 *    Adaptive Cards: rutas con puntos e índices, literales e `if(cond, a, b)`.
 * 2. Renderizador mínimo de Adaptive Cards a DOM: TextBlock, Container,
 *    ColumnSet/Column, Image, FactSet, Action.Execute y Action.OpenUrl.
 * 3. Simulador del "Panel de widgets" de Windows 11: un <dialog> que lista los
 *    widgets declarados en manifest.webmanifest, permite agregarlos o quitarlos
 *    y pinta cada uno con su plantilla real (ms_ac_template) y sus datos reales,
 *    pidiéndoselos al service worker con el mismo contrato que usa Windows.
 *
 * Sin dependencias, sin innerHTML, sin estilos en línea y sin tocar document,
 * window ni navigator en el nivel superior: el resolvedor se puede importar y
 * probar en Node.
 */

export const MENSAJES = Object.freeze({
  DATOS: 'WIDGET_DATOS',
  ACCION: 'WIDGET_ACCION',
  ACTUALIZADO: 'WIDGET_ACTUALIZADO',
});

/** Textos por defecto (español). Las apps con i18n pasan su propio `t`. */
export const TEXTOS = Object.freeze({
  titulo: 'Widgets',
  panelAria: 'Panel de widgets',
  cerrar: 'Cerrar panel de widgets',
  agregar: '+ Agregar widget',
  agregarTitulo: 'Agregar widgets',
  agregarAccion: 'Agregar',
  yaAgregado: 'Ya está en el panel',
  quitar: 'Quitar widget',
  volver: 'Volver al panel',
  agregado: 'Widget agregado',
  quitado: 'Widget quitado',
  actualizado: 'Widget actualizado',
  vacio: 'No tienes widgets. Usa «+ Agregar widget» para añadir uno.',
  cargando: 'Cargando widget…',
  error: 'No se pudo cargar el widget.',
  sinSw: 'Sin service worker: las acciones del widget no están disponibles.',
  noSoportado: 'Elemento no soportado: {tipo}',
  simulacion: 'Simulación del Panel de widgets de Windows 11. En Microsoft Edge para Windows estos widgets se instalan en el panel del sistema.',
  masInfo: 'Más información',
});

const URL_DOCUMENTACION = 'https://learn.microsoft.com/es-es/microsoft-edge/progressive-web-apps/how-to/widgets';

/* ================================================================
   1. Resolvedor de expresiones `${...}`
   ================================================================ */
const RE_EXPRESION = /\$\{([^{}]*)\}/g;
const RE_RUTA = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
const RE_SEGMENTO = /\.?([A-Za-z_$][\w$]*)|\[(\d+)\]/g;
const RE_NUMERO = /^-?\d+(?:\.\d+)?$/;
const RE_IF = /^if\((.*)\)$/s;
const OPERADORES = ['==', '!=', '<=', '>=', '<', '>']; // primero los de dos caracteres
const avisadas = new Set();

const aTexto = (valor) => (valor === null || valor === undefined ? '' : String(valor));

/** Sustituye `{nombre}` por `vars.nombre` en los textos de la interfaz. */
function interpolar(texto, vars) {
  return String(texto).replace(/\{(\w+)\}/g, (original, nombre) =>
    (vars && nombre in vars ? aTexto(vars[nombre]) : original));
}
const traducirPorDefecto = (clave, vars) => interpolar(TEXTOS[clave] ?? clave, vars);

/** Avisa una sola vez por expresión distinta; nunca lanza. */
function avisar(expresion) {
  if (avisadas.has(expresion)) return;
  avisadas.add(expresion);
  console.warn(`[widgets] expresión no soportada: ${expresion}`);
}

/** Recorre `datos` siguiendo una ruta validada por RE_RUTA (`a.b[0].c`). */
function leerRuta(ruta, datos) {
  let actual = datos;
  for (const m of ruta.matchAll(RE_SEGMENTO)) {
    if (actual === null || actual === undefined) return null;
    actual = actual[m[1] !== undefined ? m[1] : Number(m[2])];
  }
  return actual === undefined ? null : actual;
}

/** `'texto'` o `"texto"` sin escapes → contenido; cualquier otra cosa → undefined. */
function literalCadena(e) {
  const comilla = e[0];
  if ((comilla !== "'" && comilla !== '"') || e.length < 2 || e[e.length - 1] !== comilla) return undefined;
  const interior = e.slice(1, -1);
  return interior.includes(comilla) ? undefined : interior;
}

/** Separa por comas de nivel superior que no estén dentro de comillas. */
function separarArgumentos(texto) {
  const argumentos = [];
  let actual = '';
  let comilla = null;
  for (const c of texto) {
    if (comilla) {
      actual += c;
      if (c === comilla) comilla = null;
    } else if (c === '"' || c === "'") {
      comilla = c;
      actual += c;
    } else if (c === ',') {
      argumentos.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  argumentos.push(actual.trim());
  return argumentos;
}

/** Índice de `buscado` fuera de comillas, o -1. */
function indiceFuera(texto, buscado) {
  let comilla = null;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comilla) { if (c === comilla) comilla = null; continue; }
    if (c === '"' || c === "'") { comilla = c; continue; }
    if (texto.startsWith(buscado, i)) return i;
  }
  return -1;
}

/** `operando [op operando]`; sin operador se usa la veracidad JS del operando. */
function evaluarCondicion(condicion, datos) {
  for (const op of OPERADORES) {
    const i = indiceFuera(condicion, op);
    if (i === -1) continue;
    const a = resolverExpresion(condicion.slice(0, i), datos);
    const b = resolverExpresion(condicion.slice(i + op.length), datos);
    const iguales = a === b || String(a) === String(b);
    switch (op) {
      case '==': return iguales;
      case '!=': return !iguales;
      case '<=': return Number(a) <= Number(b);
      case '>=': return Number(a) >= Number(b);
      case '<': return Number(a) < Number(b);
      default: return Number(a) > Number(b);
    }
  }
  return Boolean(resolverExpresion(condicion, datos));
}

/**
 * Resuelve una expresión (sin `${}`) contra `datos` y devuelve el valor crudo.
 * Acepta literales, rutas e `if(cond, a, b)`; todo lo demás → null, sin lanzar.
 */
export function resolverExpresion(expresion, datos) {
  const e = aTexto(expresion).trim();
  try {
    const literal = literalCadena(e);
    if (literal !== undefined) return literal;
    if (RE_NUMERO.test(e)) return Number(e);
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (e === 'null') return null;
    if (RE_RUTA.test(e)) return leerRuta(e, datos);
    const condicional = RE_IF.exec(e);
    if (condicional) {
      const argumentos = separarArgumentos(condicional[1]);
      if (argumentos.length === 3) {
        return resolverExpresion(evaluarCondicion(argumentos[0], datos) ? argumentos[1] : argumentos[2], datos);
      }
    }
  } catch { /* cae al aviso */ }
  avisar(e);
  return null;
}

/** Sustituye cada `${...}` del texto; siempre devuelve string si recibe string. */
export function enlazarTexto(texto, datos) {
  if (typeof texto !== 'string') return texto;
  return texto.replace(RE_EXPRESION, (_, e) => aTexto(resolverExpresion(e.trim(), datos)));
}

/** Clon profundo de la plantilla con todos sus strings enlazados. */
export function enlazarPlantilla(nodo, datos) {
  if (typeof nodo === 'string') return enlazarTexto(nodo, datos);
  if (Array.isArray(nodo)) return nodo.map((hijo) => enlazarPlantilla(hijo, datos));
  if (nodo && typeof nodo === 'object') {
    const salida = {};
    for (const [clave, valor] of Object.entries(nodo)) salida[clave] = enlazarPlantilla(valor, datos);
    return salida;
  }
  return nodo;
}

/* ================================================================
   2. Renderizador de Adaptive Cards (DOM, clases ac-*)
   ================================================================ */
function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}
const enumerado = (valor) => aTexto(valor).toLowerCase();

/** URL absoluta solo si es http/https; si no, null. */
function urlSegura(ruta, base) {
  try {
    const url = new URL(aTexto(ruta), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function aplicarComunes(el, def) {
  if (def.spacing) el.dataset.spacing = enumerado(def.spacing);
  if (def.separator === true) el.dataset.separator = 'true';
  return el;
}

function renderTextBlock(def) {
  const p = crear('p', 'ac-texto', aTexto(def.text));
  if (def.size) p.dataset.size = enumerado(def.size);
  if (def.weight) p.dataset.weight = enumerado(def.weight);
  if (def.color) p.dataset.color = enumerado(def.color);
  if (def.horizontalAlignment) p.dataset.align = enumerado(def.horizontalAlignment);
  if (def.isSubtle === true) p.dataset.subtle = 'true';
  if (def.wrap === false) p.dataset.wrap = 'false';
  return p;
}

function renderContainer(def, ctx) {
  const div = crear('div', 'ac-contenedor');
  if (def.style) div.dataset.style = enumerado(def.style);
  anexarElementos(div, def.items, ctx);
  return div;
}

function renderColumnSet(def, ctx) {
  const conjunto = crear('div', 'ac-columnas');
  for (const col of Array.isArray(def.columns) ? def.columns : []) {
    const columna = crear('div', 'ac-columna');
    const ancho = col?.width;
    if (ancho === 'auto') {
      columna.dataset.ancho = 'auto';
    } else if (typeof ancho === 'number' || RE_NUMERO.test(aTexto(ancho))) {
      columna.dataset.ancho = 'peso';
      columna.style.flexGrow = String(Number(ancho));
    } else if (/^\d+(?:\.\d+)?px$/.test(aTexto(ancho))) {
      columna.dataset.ancho = 'px';
      columna.style.flexBasis = aTexto(ancho);
    } else {
      columna.dataset.ancho = 'stretch';
    }
    if (col?.verticalContentAlignment) columna.dataset.valign = enumerado(col.verticalContentAlignment);
    aplicarComunes(columna, col ?? {});
    anexarElementos(columna, col?.items, ctx);
    conjunto.append(columna);
  }
  return conjunto;
}

function renderImage(def, ctx) {
  const src = urlSegura(def.url, ctx.base);
  if (!src) return null; // protocolo no permitido: se omite el elemento
  const img = crear('img', 'ac-imagen');
  img.alt = aTexto(def.altText);
  img.src = src;
  if (def.size) img.dataset.size = enumerado(def.size);
  if (def.style === 'person') img.dataset.style = 'person';
  if (def.horizontalAlignment) img.dataset.align = enumerado(def.horizontalAlignment);
  return img;
}

function renderFactSet(def) {
  const dl = crear('dl', 'ac-hechos');
  for (const hecho of Array.isArray(def.facts) ? def.facts : []) {
    const fila = crear('div', 'ac-hecho');
    fila.append(crear('dt', '', aTexto(hecho?.title)), crear('dd', '', aTexto(hecho?.value)));
    dl.append(fila);
  }
  return dl;
}

function desconocido(tipo, ctx) {
  const caja = crear('div', 'ac-desconocido', ctx.t('noSoportado', { tipo: aTexto(tipo) }));
  caja.setAttribute('role', 'note');
  return caja;
}

/** Un elemento roto nunca tumba la tarjeta: se sustituye por .ac-desconocido. */
function renderizarElemento(def, ctx) {
  try {
    switch (def?.type) {
      case 'TextBlock': return aplicarComunes(renderTextBlock(def), def);
      case 'Container': return aplicarComunes(renderContainer(def, ctx), def);
      case 'ColumnSet': return aplicarComunes(renderColumnSet(def, ctx), def);
      case 'Image': { const img = renderImage(def, ctx); return img ? aplicarComunes(img, def) : null; }
      case 'FactSet': return aplicarComunes(renderFactSet(def), def);
      default: return desconocido(def?.type, ctx);
    }
  } catch (error) {
    console.warn('[widgets] elemento no renderizable', error);
    return desconocido(def?.type, ctx);
  }
}

function anexarElementos(padre, items, ctx) {
  for (const def of Array.isArray(items) ? items : []) {
    const el = renderizarElemento(def, ctx);
    if (el) padre.append(el);
  }
}

function renderizarAccion(def, ctx) {
  const titulo = aTexto(def?.title);
  try {
    if (def?.type === 'Action.Execute') {
      const boton = crear('button', 'ac-accion', titulo);
      boton.type = 'button';
      boton.dataset.verb = aTexto(def.verb);
      if (def.style) boton.dataset.style = enumerado(def.style);
      boton.addEventListener('click', () => ctx.alEjecutar?.(aTexto(def.verb), def));
      return boton;
    }
    if (def?.type === 'Action.OpenUrl') {
      const href = urlSegura(def.url, ctx.base);
      if (href) {
        const enlace = crear('a', 'ac-accion ac-accion--enlace', titulo);
        enlace.href = href;
        enlace.target = '_blank';
        enlace.rel = 'noopener noreferrer';
        if (def.style) enlace.dataset.style = enumerado(def.style);
        return enlace;
      }
      const boton = crear('button', 'ac-accion', titulo);
      boton.type = 'button';
      boton.disabled = true;
      return boton;
    }
  } catch (error) {
    console.warn('[widgets] acción no renderizable', error);
  }
  const boton = crear('button', 'ac-accion', titulo || aTexto(def?.type));
  boton.type = 'button';
  boton.disabled = true;
  boton.title = ctx.t('noSoportado', { tipo: aTexto(def?.type) });
  return boton;
}

/**
 * Convierte una Adaptive Card (enlazada o no) en un elemento `.ac-tarjeta`.
 * @param {object} plantilla  JSON de la tarjeta
 * @param {object|null} datos  si se pasa, se enlaza la plantilla antes de pintar
 * @param {{ alEjecutar?: Function, base?: string, t?: Function }} opciones
 */
export function renderizarTarjeta(plantilla, datos, opciones = {}) {
  const ctx = {
    alEjecutar: opciones.alEjecutar,
    base: opciones.base ?? globalThis.location?.href,
    t: typeof opciones.t === 'function' ? opciones.t : traducirPorDefecto,
  };
  const tarjeta = datos ? enlazarPlantilla(plantilla, datos) : plantilla;
  const raiz = crear('div', 'ac-tarjeta');
  const cuerpo = crear('div', 'ac-cuerpo');
  anexarElementos(cuerpo, tarjeta?.body, ctx);
  raiz.append(cuerpo);
  const acciones = Array.isArray(tarjeta?.actions) ? tarjeta.actions : [];
  if (acciones.length > 0) {
    const contenedor = crear('div', 'ac-acciones');
    for (const def of acciones) contenedor.append(renderizarAccion(def, ctx));
    raiz.append(contenedor);
  }
  return raiz;
}

/* ================================================================
   3. Mensajería página ↔ service worker
   ================================================================ */
const haySw = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

/** Service worker activo, o null si no hay soporte o tarda más de `limite` ms. */
function swListo(limite = 3000) {
  if (!haySw()) return Promise.resolve(null);
  return new Promise((resolver) => {
    const temporizador = setTimeout(() => resolver(null), limite);
    navigator.serviceWorker.ready.then(
      (registro) => { clearTimeout(temporizador); resolver(registro.active ?? null); },
      () => { clearTimeout(temporizador); resolver(null); },
    );
  });
}

/** La página publica los datos más recientes del widget (silencioso sin SW). */
export function enviarDatosWidget(tag, datos) {
  if (!haySw()) return;
  navigator.serviceWorker.ready
    .then((registro) => registro.active?.postMessage({ tipo: MENSAJES.DATOS, tag, datos }))
    .catch(() => {});
}

/** Suscribe `callback(datos)` a los WIDGET_ACTUALIZADO de un tag; devuelve el desuscriptor. */
export function alActualizarWidget(tag, callback) {
  if (!haySw()) return () => {};
  const escucha = (evento) => {
    const m = evento.data;
    if (m && m.tipo === MENSAJES.ACTUALIZADO && m.tag === tag) callback(m.datos);
  };
  navigator.serviceWorker.addEventListener('message', escucha);
  return () => navigator.serviceWorker.removeEventListener('message', escucha);
}

/* ================================================================
   4. Panel de widgets (simulador del Widgets Board de Windows 11)
   ================================================================ */
/**
 * @param {object} opciones
 *   boton         control de la barra de título que abre el panel
 *   anunciar      función de la región viva de la app
 *   t             traductor (clave, vars) → texto; por defecto TEXTOS en español
 *   claveAlmacen  clave de localStorage con el array JSON de tags instalados
 *   urlManifest   URL del manifest (por defecto el <link rel="manifest">)
 * @returns {{ abrir: Function, cerrar: Function, retraducir: Function, destruir: Function }}
 */
export function crearPanelWidgets(opciones = {}) {
  const boton = opciones.boton ?? null;
  const anunciar = typeof opciones.anunciar === 'function' ? opciones.anunciar : () => {};
  const t = typeof opciones.t === 'function' ? opciones.t : traducirPorDefecto;
  const claveAlmacen = opciones.claveAlmacen ?? 'widgets-instalados';
  const urlManifest = opciones.urlManifest
    ?? document.querySelector('link[rel="manifest"]')?.href
    ?? new URL('./manifest.webmanifest', location.href).toString();
  const absoluta = (ruta) => new URL(aTexto(ruta), urlManifest).toString();

  let manifest = null;
  let cargaManifest = null;
  let widgets = [];
  let focoAnterior = null;
  let temporizadores = [];
  const plantillas = new Map();   // url → promesa del JSON
  const ultimosDatos = new Map(); // tag → últimos datos recibidos
  const pendientes = new Map();   // tag → petición WIDGET_DATOS en vuelo
  const tarjetas = new Map();     // tag → tarjeta montada

  /* --- Estructura del diálogo (ver plan §1.3) --- */
  const dialogo = crear('dialog', 'pw-panel');
  dialogo.id = 'panel-widgets';
  dialogo.setAttribute('aria-labelledby', 'pw-titulo');

  const cabecera = crear('div', 'pw-cabecera');
  const icono = crear('img', 'pw-icono');
  icono.alt = '';
  icono.width = 28;
  icono.height = 28;
  icono.hidden = true;
  const titulo = crear('h2', 'pw-titulo');
  titulo.id = 'pw-titulo';
  const cerrarBtn = crear('button', 'pw-cerrar', '×');
  cerrarBtn.type = 'button';
  cabecera.append(icono, titulo, cerrarBtn);

  const vista = crear('div', 'pw-vista');
  vista.dataset.vista = 'panel';
  const tablero = crear('section', 'pw-tablero');
  const herramientas = crear('div', 'pw-herramientas');
  const agregarBtn = crear('button', 'pw-agregar-boton');
  agregarBtn.type = 'button';
  herramientas.append(agregarBtn);
  const rejilla = crear('div', 'pw-rejilla');
  const vacio = crear('p', 'pw-vacio');
  vacio.hidden = true;
  tablero.append(herramientas, rejilla, vacio);

  const selector = crear('section', 'pw-agregar');
  selector.hidden = true;
  selector.setAttribute('aria-labelledby', 'pw-agregar-titulo');
  const selectorTitulo = crear('h3', 'pw-agregar__titulo');
  selectorTitulo.id = 'pw-agregar-titulo';
  const listaOpciones = crear('ul', 'pw-opciones');
  const volverBtn = crear('button', 'pw-volver');
  volverBtn.type = 'button';
  selector.append(selectorTitulo, listaOpciones, volverBtn);
  vista.append(tablero, selector);

  const aviso = crear('p', 'pw-aviso');
  aviso.setAttribute('role', 'note');
  const avisoTexto = document.createTextNode('');
  const avisoEnlace = crear('a');
  avisoEnlace.href = URL_DOCUMENTACION;
  avisoEnlace.target = '_blank';
  avisoEnlace.rel = 'noopener noreferrer';
  aviso.append(avisoTexto, ' ', avisoEnlace);

  dialogo.append(cabecera, vista, aviso);
  document.body.append(dialogo);

  /* --- Persistencia (siempre en try/catch: modo privado) --- */
  function leerInstalados() {
    try {
      const lista = JSON.parse(localStorage.getItem(claveAlmacen) ?? '[]');
      return Array.isArray(lista) ? lista.filter((tag) => typeof tag === 'string') : [];
    } catch { return []; }
  }
  function guardarInstalados(tags) {
    try { localStorage.setItem(claveAlmacen, JSON.stringify(tags)); } catch { /* modo privado */ }
  }

  /* --- Manifest y plantillas (cacheados en memoria) --- */
  function cargarManifest() {
    if (manifest) return Promise.resolve(manifest);
    cargaManifest ??= fetch(urlManifest)
      .then((respuesta) => {
        if (!respuesta.ok) throw new Error(`manifest → ${respuesta.status}`);
        return respuesta.json();
      })
      .then((json) => {
        manifest = json && typeof json === 'object' ? json : {};
        widgets = Array.isArray(manifest.widgets)
          ? manifest.widgets.filter((w) => w && typeof w.tag === 'string')
          : [];
        const srcIcono = manifest.icons?.[0]?.src;
        if (srcIcono) { icono.src = absoluta(srcIcono); icono.hidden = false; }
        return manifest;
      })
      .catch((error) => {
        console.warn('[widgets] no se pudo leer el manifest', error);
        cargaManifest = null;
        return null;
      });
    return cargaManifest;
  }

  function obtenerPlantilla(url) {
    if (!plantillas.has(url)) {
      const promesa = fetch(url)
        .then((respuesta) => {
          if (!respuesta.ok) throw new Error(`plantilla → ${respuesta.status}`);
          return respuesta.json();
        })
        .catch((error) => { plantillas.delete(url); throw error; });
      plantillas.set(url, promesa);
    }
    return plantillas.get(url);
  }

  /* --- Datos: primero el service worker, si no los JSON estáticos --- */
  function esperarActualizacion(tag, enviar, plazo) {
    let pendiente = pendientes.get(tag);
    if (!pendiente) {
      pendiente = {};
      pendiente.promesa = new Promise((resolver) => {
        pendiente.resolver = (datos) => {
          clearTimeout(pendiente.temporizador);
          pendientes.delete(tag);
          resolver(datos);
        };
        pendiente.temporizador = setTimeout(() => pendiente.resolver(null), plazo);
      });
      pendientes.set(tag, pendiente);
      enviar();
    }
    return pendiente.promesa;
  }

  async function pedirDatos(widget) {
    const { tag } = widget;
    let datos = null;
    const activo = await swListo(3000);
    if (activo) {
      datos = await esperarActualizacion(tag, () => activo.postMessage({ tipo: MENSAJES.DATOS, tag }), 4000);
    }
    if (!datos || typeof datos !== 'object') {
      const respuesta = await fetch(absoluta(widget.data));
      if (!respuesta.ok) throw new Error(`datos → ${respuesta.status}`);
      datos = await respuesta.json();
    }
    ultimosDatos.set(tag, datos);
    return datos;
  }

  const alMensaje = (evento) => {
    const m = evento.data;
    if (!m || typeof m !== 'object' || m.tipo !== MENSAJES.ACTUALIZADO || typeof m.tag !== 'string') return;
    if (!m.datos || typeof m.datos !== 'object') return;
    ultimosDatos.set(m.tag, m.datos);
    const pendiente = pendientes.get(m.tag);
    if (pendiente) { pendiente.resolver(m.datos); return; }
    const tarjeta = tarjetas.get(m.tag);
    if (tarjeta?.plantilla && tarjeta.articulo.isConnected) pintarCuerpo(tarjeta, m.datos);
  };
  if (haySw()) navigator.serviceWorker.addEventListener('message', alMensaje);

  async function ejecutarAccion(tag, verb) {
    const activo = await swListo(3000);
    if (!activo) { anunciar(t('sinSw')); return; }
    const datos = await esperarActualizacion(tag, () => activo.postMessage({ tipo: MENSAJES.ACCION, tag, verb }), 4000);
    if (!datos) return;
    const tarjeta = tarjetas.get(tag);
    if (tarjeta?.plantilla) pintarCuerpo(tarjeta, datos);
    anunciar(t('actualizado'));
  }

  /* --- Tarjetas --- */
  function estado(clave) {
    const p = crear('p', 'pw-estado', t(clave));
    p.dataset.clave = clave;
    if (clave === 'error') p.classList.add('pw-estado--error');
    return p;
  }

  function pintarCuerpo(tarjeta, datos) {
    tarjeta.cuerpo.replaceChildren(renderizarTarjeta(tarjeta.plantilla, datos, {
      alEjecutar: (verb) => ejecutarAccion(tarjeta.widget.tag, verb),
      t,
    }));
  }

  async function cargarTarjeta(tarjeta) {
    const { widget } = tarjeta;
    try {
      const plantilla = await obtenerPlantilla(absoluta(widget.ms_ac_template));
      const datos = await pedirDatos(widget);
      if (tarjetas.get(widget.tag) !== tarjeta) return; // se quitó mientras cargaba
      tarjeta.plantilla = plantilla;
      pintarCuerpo(tarjeta, datos);
    } catch (error) {
      console.warn('[widgets] no se pudo cargar el widget', widget.tag, error);
      if (tarjetas.get(widget.tag) === tarjeta) tarjeta.cuerpo.replaceChildren(estado('error'));
    }
  }

  function actualizarVacio() { vacio.hidden = tarjetas.size > 0; }

  function desmontarTarjeta(tag) {
    const tarjeta = tarjetas.get(tag);
    if (!tarjeta) return;
    tarjeta.articulo.remove();
    tarjetas.delete(tag);
    actualizarVacio();
  }

  function montarTarjeta(widget) {
    desmontarTarjeta(widget.tag);
    const nombre = aTexto(widget.name) || widget.tag;

    const articulo = crear('article', 'pw-tarjeta');
    articulo.setAttribute('role', 'group');
    articulo.setAttribute('aria-label', nombre);
    articulo.dataset.tag = widget.tag;
    articulo.tabIndex = -1;

    const cabeceraTarjeta = crear('header', 'pw-tarjeta__cabecera');
    const iconoTarjeta = crear('img', 'pw-tarjeta__icono');
    iconoTarjeta.alt = '';
    const srcIcono = widget.icons?.[0]?.src ?? manifest?.icons?.[0]?.src;
    if (srcIcono) iconoTarjeta.src = absoluta(srcIcono); else iconoTarjeta.hidden = true;
    const quitarBtn = crear('button', 'pw-quitar', '×');
    quitarBtn.type = 'button';
    quitarBtn.setAttribute('aria-label', `${t('quitar')} ${nombre}`);
    quitarBtn.addEventListener('click', () => quitarWidget(widget.tag));
    cabeceraTarjeta.append(iconoTarjeta, crear('span', 'pw-tarjeta__nombre', nombre), quitarBtn);

    const cuerpo = crear('div', 'pw-tarjeta__cuerpo');
    cuerpo.append(estado('cargando'));
    articulo.append(cabeceraTarjeta, cuerpo);
    rejilla.append(articulo);

    const tarjeta = { widget, nombre, articulo, cuerpo, quitarBtn, plantilla: null };
    tarjetas.set(widget.tag, tarjeta);
    actualizarVacio();
    cargarTarjeta(tarjeta);
    return tarjeta;
  }

  function montarInstalados() {
    for (const tag of [...tarjetas.keys()]) desmontarTarjeta(tag);
    const porTag = new Map(widgets.map((w) => [w.tag, w]));
    for (const tag of leerInstalados()) {
      const widget = porTag.get(tag);
      if (widget) montarTarjeta(widget); // los tags que ya no existen se ignoran
    }
    actualizarVacio();
  }

  /* --- Refresco periódico (`update` del manifest, mínimo 15 s) --- */
  async function refrescar(tag) {
    const tarjeta = tarjetas.get(tag);
    if (!tarjeta?.plantilla) return;
    try { pintarCuerpo(tarjeta, await pedirDatos(tarjeta.widget)); } catch { /* se conserva lo pintado */ }
  }
  function detenerTemporizadores() {
    for (const id of temporizadores) clearInterval(id);
    temporizadores = [];
  }
  function arrancarTemporizadores() {
    detenerTemporizadores();
    if (!dialogo.open) return;
    for (const { widget } of tarjetas.values()) {
      if (typeof widget.update !== 'number' || !(widget.update > 0)) continue;
      temporizadores.push(setInterval(() => refrescar(widget.tag), Math.max(widget.update, 15) * 1000));
    }
  }

  /* --- Vistas: panel ↔ selector de widgets --- */
  function mostrarVista(nombre) {
    vista.dataset.vista = nombre;
    tablero.hidden = nombre !== 'panel';
    selector.hidden = nombre !== 'agregar';
  }

  function pintarSelector() {
    const instalados = new Set(leerInstalados());
    listaOpciones.replaceChildren(...widgets.map((widget) => {
      const opcion = crear('li', 'pw-opcion');
      const captura = crear('img', 'pw-opcion__captura');
      const pantalla = widget.screenshots?.[0];
      captura.alt = aTexto(pantalla?.label);
      captura.loading = 'lazy';
      captura.addEventListener('error', () => { captura.hidden = true; });
      if (pantalla?.src) captura.src = absoluta(pantalla.src); else captura.hidden = true;

      const texto = crear('div', 'pw-opcion__texto');
      texto.append(
        crear('strong', 'pw-opcion__nombre', aTexto(widget.name)),
        crear('p', 'pw-opcion__descripcion', aTexto(widget.description)),
      );

      const agregar = crear('button', 'pw-opcion__agregar');
      agregar.type = 'button';
      agregar.setAttribute('aria-label', `${t('agregarAccion')} ${aTexto(widget.name)}`);
      if (instalados.has(widget.tag)) {
        agregar.disabled = true;
        agregar.textContent = t('yaAgregado');
      } else {
        agregar.textContent = t('agregarAccion');
        agregar.addEventListener('click', () => agregarWidget(widget));
      }
      opcion.append(captura, texto, agregar);
      return opcion;
    }));
  }

  function abrirSelector() {
    pintarSelector();
    mostrarVista('agregar');
    (listaOpciones.querySelector('.pw-opcion__agregar:not(:disabled)') ?? volverBtn).focus();
  }

  function agregarWidget(widget) {
    const instalados = leerInstalados();
    if (!instalados.includes(widget.tag)) guardarInstalados([...instalados, widget.tag]);
    mostrarVista('panel');
    const tarjeta = montarTarjeta(widget);
    arrancarTemporizadores();
    anunciar(t('agregado'));
    tarjeta.articulo.focus();
  }

  function quitarWidget(tag) {
    guardarInstalados(leerInstalados().filter((x) => x !== tag));
    desmontarTarjeta(tag);
    arrancarTemporizadores();
    anunciar(t('quitado'));
    agregarBtn.focus();
  }

  /* --- Abrir / cerrar --- */
  async function abrir() {
    if (dialogo.open) return;
    focoAnterior = document.activeElement;
    if (typeof dialogo.showModal === 'function') dialogo.showModal();
    else dialogo.setAttribute('open', '');
    cerrarBtn.focus();
    await cargarManifest();
    if (!dialogo.open) return; // se cerró antes de terminar la carga
    mostrarVista('panel');
    montarInstalados();
    arrancarTemporizadores();
  }

  function cerrar() {
    if (dialogo.open) dialogo.close();
  }

  dialogo.addEventListener('close', () => {
    detenerTemporizadores();
    mostrarVista('panel');
    const destino = focoAnterior?.isConnected ? focoAnterior : boton;
    focoAnterior = null;
    destino?.focus?.();
  });
  dialogo.addEventListener('click', (evento) => { if (evento.target === dialogo) cerrar(); });
  cerrarBtn.addEventListener('click', cerrar);
  agregarBtn.addEventListener('click', abrirSelector);
  volverBtn.addEventListener('click', () => { mostrarVista('panel'); agregarBtn.focus(); });
  boton?.addEventListener('click', abrir);

  /** Vuelve a aplicar `t()` a los textos fijos (los nombres vienen del manifest). */
  function retraducir() {
    titulo.textContent = t('titulo');
    cerrarBtn.setAttribute('aria-label', t('cerrar'));
    cerrarBtn.title = t('cerrar');
    tablero.setAttribute('aria-label', t('panelAria'));
    agregarBtn.textContent = t('agregar');
    selectorTitulo.textContent = t('agregarTitulo');
    volverBtn.textContent = t('volver');
    vacio.textContent = t('vacio');
    avisoTexto.data = t('simulacion');
    avisoEnlace.textContent = t('masInfo');
    for (const tarjeta of tarjetas.values()) {
      tarjeta.quitarBtn.setAttribute('aria-label', `${t('quitar')} ${tarjeta.nombre}`);
      for (const p of tarjeta.cuerpo.querySelectorAll('.pw-estado[data-clave]')) p.textContent = t(p.dataset.clave);
    }
    if (vista.dataset.vista === 'agregar') pintarSelector();
  }

  function destruir() {
    detenerTemporizadores();
    if (haySw()) navigator.serviceWorker.removeEventListener('message', alMensaje);
    boton?.removeEventListener('click', abrir);
    dialogo.remove();
  }

  retraducir();
  return { abrir, cerrar, retraducir, destruir };
}
