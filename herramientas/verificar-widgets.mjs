/**
 * Verificación del Panel de widgets con Chrome DevTools Protocol.
 * Sin dependencias: usa el WebSocket nativo de Node (>= 22).
 *
 * Comprueba en un navegador real que:
 *   - un cálculo con los valores por defecto pinta el resultado
 *   - la barra de título tiene seis controles (incluido «Widgets»)
 *   - el panel abre como diálogo modal accesible y lista el widget del manifest
 *   - al agregar el widget, la tarjeta muestra las mismas varillas que #res-n
 *   - el resolvedor de expresiones cumple los 22 vectores del plan
 *   - el widget y el último cálculo persisten tras recargar y sin red
 *   - el service worker v4 precachea los archivos del widget
 *   - no hay errores de consola
 *
 * Además regenera widgets/ultimo-calculo-captura.png (640×600, la captura que
 * declara el manifest) y deja dos capturas de revisión en /tmp.
 *
 * Uso:  node herramientas/verificar-widgets.mjs [--url http://localhost:8162/] [--cdp 9412]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const flag = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : def;
};
const URL_APP = flag('url', 'http://localhost:8162/');
const PUERTO_CDP = Number(flag('cdp', 9412));
const TAG = 'ultimo-calculo';
const CAPTURA_WIDGET = join(RAIZ, 'widgets', `${TAG}-captura.png`);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================
   Cliente CDP mínimo
   ================================================================ */
class Cdp {
  #ws; #id = 0; #pendientes = new Map();
  eventos = [];

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (e) => {
      const mensaje = JSON.parse(e.data);
      if (mensaje.id !== undefined) {
        const pendiente = this.#pendientes.get(mensaje.id);
        this.#pendientes.delete(mensaje.id);
        mensaje.error ? pendiente?.rechazar(new Error(mensaje.error.message)) : pendiente?.resolver(mensaje.result);
      } else {
        this.eventos.push(mensaje);
      }
    });
  }

  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((resolver, rechazar) => {
      ws.addEventListener('open', resolver, { once: true });
      ws.addEventListener('error', () => rechazar(new Error('No se pudo abrir el WebSocket de CDP')), { once: true });
    });
    return new Cdp(ws);
  }

  enviar(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolver, rechazar) => {
      this.#pendientes.set(id, { resolver, rechazar });
      this.#ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.#pendientes.delete(id)) rechazar(new Error(`Tiempo agotado en ${method}`));
      }, 30_000);
    });
  }

  /** Evalúa JS en la página y devuelve el valor ya deserializado. */
  async evaluar(expresion) {
    const { result, exceptionDetails } = await this.enviar('Runtime.evaluate', {
      expression: expresion,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'Error al evaluar');
    return result.value;
  }

  cerrar() { this.#ws.close(); }
}

/* ================================================================
   Informe
   ================================================================ */
const resultados = [];
const comprobar = (nombre, ok, detalle = '') => {
  resultados.push({ nombre, ok, detalle });
  console.log(`  ${ok ? '✓' : '✗'}  ${nombre}${detalle ? `  ${detalle}` : ''}`);
};

/** Espera a que la app esté lista tras una navegación (select de varillas lleno). */
async function esperarApp(cdp) {
  for (let intento = 0; intento < 80; intento++) {
    await espera(250);
    try {
      if (await cdp.evaluar(`document.querySelectorAll('#campo-varilla option').length > 0`)) return true;
    } catch { /* la página puede estar navegando todavía */ }
  }
  return false;
}

/** Espera a que el service worker esté activado (el panel le pide los datos). */
const esperarSw = (cdp) => cdp.evaluar(`(async () => {
  for (let i = 0; i < 80; i++) {
    const r = await navigator.serviceWorker.getRegistration();
    if (r?.active?.state === 'activated') return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
})()`);

/** Los 22 vectores del plan (§1.8), evaluados dentro de la página. */
async function vectoresEnPagina() {
  const m = await import('./js/widgets.js');
  const d = { a: { b: [{ c: 'x' }, { c: 7 }] }, n: 5, s: 'demo', v: true, f: false, z: 0, nulo: null };
  const t = (k, v) => (m.TEXTOS[k] ?? k).replace(/\{(\w+)\}/g, (_, nombre) => String(v?.[nombre] ?? ''));
  const original = { type: 'TextBlock', text: '${s}', items: [{ text: '${n}' }], wrap: true };
  const copia = JSON.stringify(original);
  const casos = [
    ['1', m.enlazarTexto('${a.b[1].c}', d), '7'],
    ['2', m.enlazarTexto('Valor: ${a.b[0].c}!', d), 'Valor: x!'],
    ['3', m.enlazarTexto('${no.existe}', d), ''],
    ['4', m.enlazarTexto('${a.b[5].c} fin', d), ' fin'],
    ['5', m.enlazarTexto("${if(s == 'demo', 'Demo', 'Vivo')}", d), 'Demo'],
    ['6', m.enlazarTexto("${if(n > 3, 'mayor', 'menor')}", d), 'mayor'],
    ['7', m.enlazarTexto("${if(v, 'sí', 'no')}", d), 'sí'],
    ['8', m.enlazarTexto("${if(f, 'sí', 'no')}", d), 'no'],
    ['9', m.enlazarTexto("${if(z, 'sí', 'no')}", d), 'no'],
    ['10', m.enlazarTexto("${if(nulo == null, 'nulo', 'algo')}", d), 'nulo'],
    ['11', m.enlazarTexto("${if(no.existe == null, 'nulo', 'algo')}", d), 'nulo'],
    ['12', m.enlazarTexto("${if(n == '5', 'igual', 'dif')}", d), 'igual'],
    ['13', m.enlazarTexto("${if(s == 'a, b', 'coma', 'sin')}", d), 'sin'],
    ['14', m.enlazarTexto('${n} y ${s}', d), '5 y demo'],
    ['15', m.enlazarTexto('sin expresiones', d), 'sin expresiones'],
    ['16', m.enlazarTexto('${', d), '${'],
    ['17', m.resolverExpresion('a.b[1].c', d), 7],
    ['18', m.resolverExpresion('if(n >= 5, n, 0)', d), 5],
    ['19', JSON.stringify([m.resolverExpresion("'lit'", d), m.resolverExpresion('3.5', d), m.resolverExpresion('true', d)]),
      JSON.stringify(['lit', 3.5, true])],
    ['20', m.resolverExpresion('expresion invalida ++', d), null],
    ['21', JSON.stringify(m.enlazarPlantilla(original, d)) + '|' + String(JSON.stringify(original) === copia),
      JSON.stringify({ type: 'TextBlock', text: 'demo', items: [{ text: '5' }], wrap: true }) + '|true'],
  ];
  let v22 = 'sin ejecutar';
  try {
    const nodo = m.renderizarTarjeta({ type: 'AdaptiveCard', body: [{ type: 'Desconocido' }] }, {}, { t });
    v22 = nodo.querySelector('.ac-desconocido')?.textContent ?? 'sin .ac-desconocido';
  } catch (e) { v22 = `excepción: ${e.message}`; }
  casos.push(['22', v22, 'Elemento no soportado: Desconocido']);
  const fallos = casos.filter(([, real, esperado]) => real !== esperado).map(([n, real, esperado]) => `#${n}: ${JSON.stringify(real)} ≠ ${JSON.stringify(esperado)}`);
  return { total: casos.length, correctos: casos.length - fallos.length, fallos };
}

/** Dimensiones de un PNG leyendo su cabecera IHDR. */
function dimensionesPng(ruta) {
  const b = readFileSync(ruta);
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
}

/* ================================================================
   Principal
   ================================================================ */
const perfil = mkdtempSync(join(tmpdir(), 'calculadora-widgets-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PUERTO_CDP}`,
  `--user-data-dir=${perfil}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

let cdp;
let codigoSalida = 0;

try {
  /* --- Localizar el target de la página ------------------------------- */
  let objetivo;
  for (let intento = 0; intento < 60; intento++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json();
      objetivo = lista.find((t) => t.type === 'page');
      if (objetivo?.webSocketDebuggerUrl) break;
    } catch { /* Chrome aún no escucha */ }
    await espera(250);
  }
  if (!objetivo) throw new Error('Chrome no expuso ningún target de página');

  cdp = await Cdp.conectar(objetivo.webSocketDebuggerUrl);
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Log.enable');
  await cdp.enviar('Page.enable');
  await cdp.enviar('Network.enable');

  /* --- 1. Carga y cálculo ---------------------------------------------- */
  console.log(`\nCargando ${URL_APP}\n`);
  await cdp.enviar('Page.navigate', { url: URL_APP });
  const lista = await esperarApp(cdp);
  const swActivo = await esperarSw(cdp);

  console.log('Cálculo');
  comprobar('La app carga y llena el selector de varillas', lista);
  comprobar('El service worker queda activado', swActivo);

  const calculo = await cdp.evaluar(`(async () => {
    document.getElementById('form-columna').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (!document.getElementById('resultado').hidden) break;
    }
    return {
      visible: !document.getElementById('resultado').hidden,
      n: document.getElementById('res-n').textContent.trim(),
      varilla: document.getElementById('res-varilla').textContent.trim(),
      distribucion: document.getElementById('res-distribucion').textContent.trim(),
      estribo: document.getElementById('res-estribo').textContent.trim(),
    };
  })()`);
  comprobar('El cálculo con los valores por defecto pinta el resultado',
    calculo.visible && /^\d+$/.test(calculo.n) && calculo.varilla.length > 0,
    `${calculo.n} varillas de ${calculo.varilla}`);
  const { n, varilla } = calculo;

  /* --- 2. Controles de ventana ---------------------------------------- */
  console.log('\nControles de ventana');
  const controles = await cdp.evaluar(`(() => {
    const botones = [...document.querySelectorAll('[data-control-ventana]')];
    const region = (el) => {
      const cs = getComputedStyle(el);
      return (cs.getPropertyValue('app-region') || cs.getPropertyValue('-webkit-app-region') || '').trim();
    };
    return {
      cuantos: botones.length,
      ids: botones.map(b => b.id),
      todosAccesibles: botones.every(b => b.getAttribute('aria-label') && b.title && b.querySelector('svg')),
      noDrag: botones.every(b => (region(b) || 'no-drag') === 'no-drag'),
      cabeceraDrag: region(document.querySelector('.cabecera')) === 'drag',
    };
  })()`);
  comprobar('Hay seis controles con aria-label, title e icono y la cabecera es arrastrable',
    controles.cuantos === 6 && controles.ids.includes('control-widgets') && controles.todosAccesibles
      && controles.noDrag && controles.cabeceraDrag,
    controles.ids.join(', '));

  /* --- 3. Panel de widgets -------------------------------------------- */
  console.log('\nPanel de widgets');
  const apertura = await cdp.evaluar(`(async () => {
    const boton = document.getElementById('control-widgets');
    boton.focus();
    boton.click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (document.querySelector('#panel-widgets .pw-agregar-boton')?.textContent) break;
    }
    const d = document.getElementById('panel-widgets');
    return {
      abierto: !!d?.open,
      focoEnCerrar: document.activeElement?.classList.contains('pw-cerrar'),
      labelledby: d?.getAttribute('aria-labelledby'),
      titulo: document.getElementById('pw-titulo')?.textContent,
      aviso: document.querySelector('#panel-widgets .pw-aviso')?.textContent ?? '',
      enlaceDoc: document.querySelector('#panel-widgets .pw-aviso a')?.href ?? '',
      tabletoAria: document.querySelector('#panel-widgets .pw-tablero')?.getAttribute('aria-label'),
    };
  })()`);
  comprobar('El control Widgets abre el panel con el foco en Cerrar',
    apertura.abierto && apertura.focoEnCerrar && apertura.labelledby === 'pw-titulo' && apertura.titulo === 'Widgets',
    `título «${apertura.titulo}» · aria-labelledby=${apertura.labelledby}`);
  comprobar('El panel muestra el aviso de simulación con enlace a la documentación',
    /Simulación del Panel de widgets de Windows 11/.test(apertura.aviso)
      && apertura.enlaceDoc.startsWith('https://learn.microsoft.com/es-es/microsoft-edge/progressive-web-apps/how-to/widgets')
      && apertura.tabletoAria === 'Panel de widgets');

  const manifest = await cdp.evaluar(`(async () => {
    const m = await (await fetch('./manifest.webmanifest')).json();
    const w = (m.widgets || [])[0] || {};
    const plantilla = await fetch(w.ms_ac_template);
    const datos = await fetch(w.data);
    const pj = await plantilla.json();
    const dj = await datos.json();
    return {
      cuantos: (m.widgets || []).length,
      campos: ['name', 'short_name', 'description', 'tag', 'template', 'ms_ac_template', 'data', 'type', 'screenshots', 'icons', 'auth', 'update']
        .filter(c => w[c] === undefined),
      tag: w.tag, auth: w.auth, update: typeof w.update, tipo: w.type,
      capturas: (w.screenshots || []).length, etiqueta: w.screenshots?.[0]?.label, sizes: w.screenshots?.[0]?.sizes,
      plantillaOk: plantilla.ok && pj.type === 'AdaptiveCard' && pj.version === '1.5',
      abrir: (pj.actions || []).some(a => a.type === 'Action.OpenUrl' && a.title === 'Abrir calculadora'),
      datosOk: datos.ok && dj.hayCalculo === false && typeof dj.urlApp === 'string',
    };
  })()`);
  comprobar('El manifest declara el widget con todos los campos requeridos',
    manifest.cuantos === 1 && manifest.campos.length === 0 && manifest.tag === TAG && manifest.auth === false
      && manifest.update === 'number' && manifest.tipo === 'application/json' && manifest.capturas >= 1
      && /\S/.test(manifest.etiqueta ?? ''),
    manifest.campos.length ? `faltan: ${manifest.campos.join(', ')}` : `tag ${manifest.tag} · captura «${manifest.etiqueta}»`);
  comprobar('La plantilla y los datos del widget responden 200 con JSON válido',
    manifest.plantillaOk && manifest.abrir && manifest.datosOk);

  const selector = await cdp.evaluar(`(async () => {
    document.querySelector('#panel-widgets .pw-agregar-boton').click();
    await new Promise(r => setTimeout(r, 150));
    return {
      vista: document.querySelector('#panel-widgets .pw-vista').dataset.vista,
      opciones: document.querySelectorAll('#panel-widgets .pw-opcion').length,
      nombre: document.querySelector('#panel-widgets .pw-opcion__nombre')?.textContent,
      descripcion: document.querySelector('#panel-widgets .pw-opcion__descripcion')?.textContent ?? '',
      captura: !!document.querySelector('#panel-widgets .pw-opcion__captura')?.getAttribute('src'),
      foco: document.activeElement?.className,
    };
  })()`);
  comprobar('El selector lista el widget del manifest',
    selector.vista === 'agregar' && selector.opciones === 1 && selector.nombre === 'Último cálculo'
      && selector.descripcion.length > 20 && selector.captura && selector.foco === 'pw-opcion__agregar',
    `${selector.opciones} opción · «${selector.nombre}»`);

  const tarjeta = await cdp.evaluar(`(async () => {
    document.querySelector('#panel-widgets .pw-opcion__agregar').click();
    const n = ${JSON.stringify(n)};
    const varilla = ${JSON.stringify(varilla)};
    let textos = [];
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      textos = [...document.querySelectorAll('#panel-widgets .pw-tarjeta .ac-texto')].map(p => p.textContent);
      if (textos.some(t => t === n)) break;
    }
    const t = document.querySelector('#panel-widgets .pw-tarjeta');
    return {
      vista: document.querySelector('#panel-widgets .pw-vista').dataset.vista,
      tarjetas: document.querySelectorAll('#panel-widgets .pw-tarjeta').length,
      mismoN: textos.some(x => x === n),
      mismaVarilla: textos.some(x => x.includes(varilla)),
      textos,
      grupo: t?.getAttribute('role') === 'group' && !!t?.getAttribute('aria-label'),
      focoEnTarjeta: document.activeElement === t,
      hechos: document.querySelectorAll('#panel-widgets .pw-tarjeta .ac-hecho').length,
      anuncio: document.getElementById('estado-sw').textContent,
      vacioOculto: getComputedStyle(document.querySelector('#panel-widgets .pw-vacio')).display === 'none',
      error: !!document.querySelector('#panel-widgets .pw-estado--error'),
    };
  })()`);
  comprobar('Agregar el widget pinta la tarjeta con las mismas varillas que el resultado',
    tarjeta.vista === 'panel' && tarjeta.tarjetas === 1 && tarjeta.mismoN && tarjeta.mismaVarilla && !tarjeta.error,
    `«${tarjeta.textos.slice(0, 3).join('» «')}»`);
  comprobar('La tarjeta es un grupo accesible, recibe el foco y se anuncia «Widget agregado»',
    tarjeta.grupo && tarjeta.focoEnTarjeta && /Widget agregado/.test(tarjeta.anuncio) && tarjeta.vacioOculto && tarjeta.hechos === 3,
    `anuncio «${tarjeta.anuncio}» · ${tarjeta.hechos} hechos`);

  const accion = await cdp.evaluar(`(() => {
    const a = document.querySelector('#panel-widgets .pw-tarjeta .ac-accion--enlace');
    if (!a) return { existe: false };
    return { existe: true, texto: a.textContent, ruta: new URL(a.href).pathname, rel: a.rel, target: a.target, origen: new URL(a.href).origin };
  })()`);
  comprobar('La acción «Abrir calculadora» es un enlace al inicio de la app',
    accion.existe && accion.texto === 'Abrir calculadora' && accion.ruta === new URL(URL_APP).pathname
      && accion.origen === new URL(URL_APP).origin && /noopener/.test(accion.rel),
    accion.existe ? `${accion.origen}${accion.ruta} · rel=${accion.rel}` : 'sin enlace');

  const vectores = await cdp.evaluar(`(${vectoresEnPagina.toString()})()`);
  comprobar('Los 22 vectores del resolvedor de expresiones pasan',
    vectores.correctos === vectores.total && vectores.total === 22,
    `${vectores.correctos}/${vectores.total}${vectores.fallos.length ? `\n      ${vectores.fallos.join('\n      ')}` : ''}`);

  /* --- 4. Capturas ----------------------------------------------------- */
  console.log('\nCapturas');
  await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await espera(500);
  // El clip de captureScreenshot va en coordenadas de página: se suma el scroll
  // del documento (la app desplaza la vista al resultado tras calcular).
  const rect = await cdp.evaluar(`(() => {
    const r = document.querySelector('#panel-widgets .pw-tarjeta').getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, ancho: r.width, alto: r.height };
  })()`);
  const recorte = await cdp.enviar('Page.captureScreenshot', {
    format: 'png', clip: { x: rect.x, y: rect.y, width: 320, height: 300, scale: 2 },
  });
  writeFileSync(CAPTURA_WIDGET, Buffer.from(recorte.data, 'base64'));
  const dims = dimensionesPng(CAPTURA_WIDGET);
  comprobar('La captura del widget mide 640×600 y coincide con el manifest',
    dims.ancho === 640 && dims.alto === 600 && manifest.sizes === `${dims.ancho}x${dims.alto}` && dims.ancho <= 1024 && dims.alto <= 1024,
    `${dims.ancho}×${dims.alto} · tarjeta ${Math.round(rect.ancho)}×${Math.round(rect.alto)} px`);
  comprobar('La tarjeta del cálculo por defecto cabe entera en la captura (≤ 300 px de alto)',
    rect.alto <= 300, `${Math.round(rect.alto)} px`);

  const desborde = await cdp.evaluar(`(() => {
    const panel = document.getElementById('panel-widgets');
    const tarjeta = panel.querySelector('.pw-tarjeta');
    const dentro = (el) => { const r = el.getBoundingClientRect(); const p = panel.getBoundingClientRect(); return r.right <= p.right + 1 && r.left >= p.left - 1; };
    return {
      tarjetaDentro: dentro(tarjeta),
      sinScrollHorizontal: panel.querySelector('.pw-vista').scrollWidth <= panel.querySelector('.pw-vista').clientWidth,
      cuerpoSinRecorte: tarjeta.querySelector('.pw-tarjeta__cuerpo').scrollWidth <= tarjeta.clientWidth,
    };
  })()`);
  comprobar('Nada desborda el panel a 1280 px',
    desborde.tarjetaDentro && desborde.sinScrollHorizontal && desborde.cuerpoSinRecorte, JSON.stringify(desborde));

  // Tema claro: el panel y la tarjeta deben cambiar con los tokens de la app.
  const temaClaro = await cdp.evaluar(`(async () => {
    const fondoOscuro = getComputedStyle(document.getElementById('panel-widgets')).backgroundColor;
    document.getElementById('control-tema').click();
    await new Promise(r => setTimeout(r, 350));
    return {
      tema: document.documentElement.dataset.tema,
      fondoOscuro,
      fondoClaro: getComputedStyle(document.getElementById('panel-widgets')).backgroundColor,
      textoTarjeta: getComputedStyle(document.querySelector('#panel-widgets .pw-tarjeta')).color,
    };
  })()`);
  writeFileSync('/tmp/calculadora-varillas-widgets-claro.png',
    Buffer.from((await cdp.enviar('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  comprobar('El panel respeta el tema claro (captura /tmp/calculadora-varillas-widgets-claro.png)',
    temaClaro.tema === 'claro' && temaClaro.fondoClaro !== temaClaro.fondoOscuro,
    `${temaClaro.fondoOscuro} → ${temaClaro.fondoClaro}`);
  await cdp.evaluar(`(async () => { document.getElementById('control-tema').click(); await new Promise(r => setTimeout(r, 300)); })()`);

  for (const [archivo, ancho, alto, movil] of [
    ['/tmp/calculadora-varillas-widgets-escritorio.png', 1280, 900, false],
    ['/tmp/calculadora-varillas-widgets-movil.png', 412, 915, true],
  ]) {
    await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil });
    await espera(500);
    const captura = await cdp.enviar('Page.captureScreenshot', { format: 'png' });
    writeFileSync(archivo, Buffer.from(captura.data, 'base64'));
    comprobar(`Captura de revisión ${archivo}`, true, `${ancho}×${alto}`);
  }
  // Vista «Agregar widgets» en móvil, también para revisión visual.
  await cdp.evaluar(`(async () => {
    document.querySelector('#panel-widgets .pw-agregar-boton').click();
    await new Promise(r => setTimeout(r, 400));
  })()`);
  writeFileSync('/tmp/calculadora-varillas-widgets-selector.png',
    Buffer.from((await cdp.enviar('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  comprobar('Captura de revisión /tmp/calculadora-varillas-widgets-selector.png', true, '412×915 · vista agregar');
  const selectorMovil = await cdp.evaluar(`(() => {
    const vista = document.querySelector('#panel-widgets .pw-vista');
    const yaAgregado = document.querySelector('#panel-widgets .pw-opcion__agregar');
    return { sinScrollHorizontal: vista.scrollWidth <= vista.clientWidth, deshabilitado: yaAgregado?.disabled, texto: yaAgregado?.textContent };
  })()`);
  comprobar('En el selector el widget ya instalado aparece como «Ya está en el panel»',
    selectorMovil.sinScrollHorizontal && selectorMovil.deshabilitado === true && selectorMovil.texto === 'Ya está en el panel',
    selectorMovil.texto ?? '');
  await cdp.evaluar(`(async () => {
    document.querySelector('#panel-widgets .pw-volver').click();
    await new Promise(r => setTimeout(r, 200));
  })()`);
  const desbordeMovil = await cdp.evaluar(`(() => {
    const vista = document.querySelector('#panel-widgets .pw-vista');
    const cabecera = document.querySelector('.cabecera');
    return {
      sinScrollHorizontal: vista.scrollWidth <= vista.clientWidth,
      panelAncho: Math.round(document.getElementById('panel-widgets').getBoundingClientRect().width),
      controlesCaben: cabecera.scrollWidth <= cabecera.clientWidth + 1,
    };
  })()`);
  comprobar('A 412 px el panel ocupa todo el ancho sin scroll horizontal y los seis controles caben',
    desbordeMovil.sinScrollHorizontal && desbordeMovil.panelAncho === 412 && desbordeMovil.controlesCaben,
    JSON.stringify(desbordeMovil));
  await cdp.enviar('Emulation.clearDeviceMetricsOverride');
  await espera(300);

  /* --- 5. Cerrar: hitbox y foco ---------------------------------------- */
  const cierre = await cdp.evaluar(`(async () => {
    const btn = document.querySelector('#panel-widgets .pw-cerrar');
    const caja = btn.getBoundingClientRect();
    const esquina = document.elementFromPoint(caja.left + 3, caja.top + 3);
    const r = { w: Math.round(caja.width), h: Math.round(caja.height), esquinaPulsable: esquina === btn || btn.contains(esquina) };
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    r.cerro = !document.getElementById('panel-widgets').open;
    r.focoVolvio = document.activeElement?.id === 'control-widgets';
    return r;
  })()`);
  comprobar('El botón de cerrar mide ≥ 44 px, su esquina es pulsable y devuelve el foco',
    cierre.w >= 44 && cierre.h >= 44 && cierre.esquinaPulsable && cierre.cerro && cierre.focoVolvio,
    `${cierre.w}×${cierre.h} · esquina ${cierre.esquinaPulsable ? 'ok' : 'MUERTA'} · cerró ${cierre.cerro} · foco devuelto ${cierre.focoVolvio}`);

  const reabierto = await cdp.evaluar(`(async () => {
    document.getElementById('control-widgets').click();
    await new Promise(r => setTimeout(r, 250));
    return document.getElementById('panel-widgets').open;
  })()`);
  // Escape real (teclado) sobre el <dialog> modal: debe cerrarlo y devolver el foco.
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.enviar('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  await espera(300);
  const escape = await cdp.evaluar(`({ cerrado: !document.getElementById('panel-widgets').open, foco: document.activeElement?.id })`);
  comprobar('Escape cierra el panel y devuelve el foco al control',
    reabierto && escape.cerrado && escape.foco === 'control-widgets', `foco en #${escape.foco}`);

  /* --- 6. Persistencia tras recargar ---------------------------------- */
  console.log('\nPersistencia');
  await cdp.enviar('Page.navigate', { url: URL_APP });
  await esperarApp(cdp);
  await esperarSw(cdp);
  const persistencia = await cdp.evaluar(`(async () => {
    const instalados = JSON.parse(localStorage.getItem('calculadora-varillas:widgets-instalados') || '[]');
    const ultimo = JSON.parse(localStorage.getItem('calculadora-varillas:ultimo-calculo') || 'null');
    const n = ${JSON.stringify(n)};
    document.getElementById('control-widgets').click();
    let textos = [];
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      textos = [...document.querySelectorAll('#panel-widgets .pw-tarjeta .ac-texto')].map(p => p.textContent);
      if (textos.some(t => t === n)) break;
    }
    const r = {
      instalados, ultimoN: ultimo?.n, hayCalculo: ultimo?.hayCalculo,
      resultadoOculto: document.getElementById('resultado').hidden,
      tarjetas: document.querySelectorAll('#panel-widgets .pw-tarjeta').length,
      mismoN: textos.some(t => t === n),
    };
    document.getElementById('panel-widgets').close();
    return r;
  })()`);
  comprobar('El widget instalado y el último cálculo persisten en localStorage',
    persistencia.instalados.includes(TAG) && persistencia.ultimoN === Number(n) && persistencia.hayCalculo === true,
    `${JSON.stringify(persistencia.instalados)} · n=${persistencia.ultimoN}`);
  comprobar('Tras recargar, el panel pinta la tarjeta con el último cálculo sin volver a calcular',
    persistencia.resultadoOculto && persistencia.tarjetas === 1 && persistencia.mismoN,
    `${persistencia.tarjetas} tarjeta · n ${persistencia.mismoN ? 'coincide' : 'NO coincide'}`);

  /* --- 7. Service worker ------------------------------------------------ */
  console.log('\nService worker');
  const sw = await cdp.evaluar(`(async () => {
    const nombres = await caches.keys();
    const shell = nombres.find(n => n === 'calculadora-varillas-shell-v4');
    const claves = shell ? (await (await caches.open(shell)).keys()).map(k => new URL(k.url).pathname) : [];
    return { nombres, shell: !!shell, claves };
  })()`);
  const precache = ['/widgets/ultimo-calculo-plantilla.json', '/widgets/ultimo-calculo-datos.json', '/widgets/ultimo-calculo-captura.png', '/js/widgets.js'];
  comprobar('El service worker v4 precachea los archivos del widget',
    sw.shell && precache.every(p => sw.claves.some(c => c.endsWith(p))),
    `${sw.nombres.join(', ')} · ${sw.claves.length} recursos`);

  /* --- 8. Offline ------------------------------------------------------- */
  console.log('\nOffline');
  await cdp.enviar('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp.enviar('Page.reload', { ignoreCache: false });
  const cargaOffline = await esperarApp(cdp);
  const offline = await cdp.evaluar(`(async () => {
    const n = ${JSON.stringify(n)};
    document.getElementById('control-widgets').click();
    let textos = [];
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      textos = [...document.querySelectorAll('#panel-widgets .pw-tarjeta .ac-texto')].map(p => p.textContent);
      if (textos.some(t => t === n)) break;
    }
    const r = {
      conexion: document.getElementById('chip-conexion').dataset.estado,
      tarjetas: document.querySelectorAll('#panel-widgets .pw-tarjeta').length,
      mismoN: textos.some(t => t === n),
      error: !!document.querySelector('#panel-widgets .pw-estado--error'),
    };
    document.getElementById('panel-widgets').close();
    return r;
  })()`);
  comprobar('El panel de widgets también funciona sin red',
    cargaOffline && offline.tarjetas === 1 && offline.mismoN && !offline.error,
    `conexión ${offline.conexion} · ${offline.tarjetas} tarjeta · n ${offline.mismoN ? 'coincide' : 'NO coincide'}`);
  await cdp.enviar('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  /* --- Consola limpia --------------------------------------------------- */
  console.log('\nConsola');
  const errores = cdp.eventos
    .filter((e) =>
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map((e) =>
      e.params.entry?.text ??
      e.params.exceptionDetails?.exception?.description ??
      e.params.args?.map((a) => a.value ?? a.description).join(' '))
    // Al emular offline es normal que fetch falle: ese error lo provoca la prueba.
    .filter((texto) => texto && !/ERR_INTERNET_DISCONNECTED|Failed to load resource.*offline/i.test(texto));

  comprobar('Sin errores de consola ni excepciones', errores.length === 0,
    errores.length ? `\n      ${errores.join('\n      ')}` : '');

  /* --- Resumen ---------------------------------------------------------- */
  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(58)}`);
  console.log(`  ${resultados.length - fallos.length}/${resultados.length} comprobaciones correctas`);
  if (fallos.length) {
    console.log('  Fallos:');
    for (const f of fallos) console.log(`    ✗ ${f.nombre} ${f.detalle}`);
    codigoSalida = 1;
  }
  console.log('─'.repeat(58));
} catch (error) {
  console.error('\nLa verificación no pudo completarse:', error.message);
  codigoSalida = 1;
} finally {
  cdp?.cerrar();
  chrome.kill('SIGKILL');
  await espera(300);
  rmSync(perfil, { recursive: true, force: true });
  process.exit(codigoSalida);
}
