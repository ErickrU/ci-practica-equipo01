/**
 * Calculadora de Varillas · Interfaz
 * ---------------------------------------------------------------------------
 * Lee el formulario, delega el cálculo en js/calculo.js (sin DOM) y pinta el
 * resultado: cifra principal, distribución, diagrama SVG a escala, detalle
 * numérico, observaciones normativas y alternativas con otros diámetros.
 */
import { VARILLAS, calcularColumna, formatear, porcentaje } from './calculo.js';
import { enviarDatosWidget } from './widgets.js';

const $ = (id) => document.getElementById(id);

const form = $('form-columna');
const selectVarilla = $('campo-varilla');
const resumenErrores = $('resumen-errores');
const vacio = $('resultado-vacio');
const resultado = $('resultado');

const CAMPOS = ['b', 'h', 'D', 'fc', 'fy', 'cuantia', 'pu', 'varilla', 'recubrimiento'];
const VARILLA_POR_DEFECTO = '5/8';

/** Último cálculo que alimenta el widget «Último cálculo» (Edge Widgets y simulador). */
const CLAVE_ULTIMO_CALCULO = 'calculadora-varillas:ultimo-calculo';
const TAG_WIDGET = 'ultimo-calculo';

/* ================================================================
   1. Preparación del formulario
   ================================================================ */

/** El select de varillas se llena desde la tabla para tener una sola fuente. */
function llenarVarillas() {
  selectVarilla.replaceChildren(
    ...VARILLAS.map((v) => {
      const opcion = document.createElement('option');
      opcion.value = v.id;
      opcion.textContent = `${v.nombre}  ·  ${formatear(v.area, 2)} cm²  (Ø ${formatear(v.diametro, 2)} cm)`;
      opcion.defaultSelected = v.id === VARILLA_POR_DEFECTO;
      return opcion;
    }),
  );
}

const valorRadio = (nombre) => form.querySelector(`input[name="${nombre}"]:checked`)?.value;

/** Muestra solo los campos que corresponden al tipo de columna y al método. */
function sincronizarGrupos() {
  const circular = valorRadio('tipo') !== 'rectangular';
  $('grupo-rectangular').hidden = circular;
  $('grupo-circular').hidden = !circular;

  const porCarga = valorRadio('metodo') === 'carga';
  $('grupo-cuantia').hidden = porCarga;
  $('grupo-carga').hidden = !porCarga;
}

/** Lee un campo numérico; vacío → NaN (Number('') sería 0). */
function numero(id) {
  const texto = $(id).value.trim().replace(',', '.');
  return texto === '' ? NaN : Number(texto);
}

function leerEntrada() {
  return {
    tipo: valorRadio('tipo'),
    b: numero('campo-b'),
    h: numero('campo-h'),
    D: numero('campo-D'),
    fc: numero('campo-fc'),
    fy: numero('campo-fy'),
    metodo: valorRadio('metodo'),
    cuantia: numero('campo-cuantia'),
    pu: numero('campo-pu'),
    varilla: selectVarilla.value,
    recubrimiento: numero('campo-recubrimiento'),
  };
}

/* ================================================================
   2. Errores de validación
   ================================================================ */

function limpiarErrores() {
  for (const campo of CAMPOS) {
    const control = $(`campo-${campo}`);
    const error = $(`error-${campo}`);
    control?.removeAttribute('aria-invalid');
    if (error) { error.hidden = true; error.textContent = ''; }
  }
  resumenErrores.hidden = true;
  resumenErrores.replaceChildren();
}

function mostrarErrores(errores) {
  limpiarErrores();

  let primero = null;
  for (const { campo, mensaje } of errores) {
    const control = $(`campo-${campo}`);
    const error = $(`error-${campo}`);
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      primero ??= control;
    }
    if (error) { error.textContent = mensaje; error.hidden = false; }
  }

  const titulo = document.createElement('strong');
  titulo.textContent = errores.length === 1 ? 'Revisa este dato:' : 'Revisa estos datos:';
  const lista = document.createElement('ul');
  for (const { mensaje } of errores) {
    const li = document.createElement('li');
    li.textContent = mensaje;
    lista.append(li);
  }
  resumenErrores.replaceChildren(titulo, lista);
  resumenErrores.hidden = false;

  primero?.focus();
}

/* ================================================================
   3. Diagrama SVG de la sección
   ================================================================ */

const n2 = (x) => x.toFixed(2);

function dibujarSeccion(r) {
  const { seccion, geometria, varilla, estribo, recubrimiento, barras } = r;
  const ancho = seccion.circular ? seccion.D : seccion.b;
  const alto = seccion.circular ? seccion.D : seccion.h;
  const mayor = Math.max(ancho, alto);

  // Márgenes para las cotas (en cm, la misma escala que la sección).
  const izq = mayor * 0.22, der = mayor * 0.06, arr = mayor * 0.06, aba = mayor * 0.22;
  const fuente = mayor * 0.075;
  const trazo = Math.max(mayor * 0.008, 0.2);
  const cota = mayor * 0.09; // distancia de la línea de cota al borde
  const viewBox = `${n2(-izq)} ${n2(-arr)} ${n2(ancho + izq + der)} ${n2(alto + arr + aba)}`;

  const descripcion = seccion.circular
    ? `Sección circular de ${formatear(seccion.D, 0)} cm de diámetro con ${barras.n} varillas de ${varilla.nombre}`
    : `Sección rectangular de ${formatear(seccion.b, 0)} por ${formatear(seccion.h, 0)} cm con ${barras.n} varillas de ${varilla.nombre}`;

  let concreto, estriboSvg, cotas;
  if (seccion.circular) {
    const c = seccion.D / 2;
    concreto = `<circle cx="${n2(c)}" cy="${n2(c)}" r="${n2(c)}" fill="#cfd6dd" stroke="#8f9aa6" stroke-width="${n2(trazo)}"/>`;
    estriboSvg = `<circle cx="${n2(c)}" cy="${n2(c)}" r="${n2(c - recubrimiento - estribo.diametro / 2)}" fill="none" stroke="#c97f12" stroke-width="${n2(estribo.diametro)}"/>`;
    cotas = cotaHorizontal(0, ancho, alto + cota, `D = ${formatear(seccion.D, 0)} cm`, fuente, trazo);
  } else {
    concreto = `<rect x="0" y="0" width="${n2(ancho)}" height="${n2(alto)}" rx="${n2(mayor * 0.01)}" fill="#cfd6dd" stroke="#8f9aa6" stroke-width="${n2(trazo)}"/>`;
    const e = recubrimiento + estribo.diametro / 2;
    estriboSvg = `<rect x="${n2(e)}" y="${n2(e)}" width="${n2(ancho - 2 * e)}" height="${n2(alto - 2 * e)}" rx="${n2(estribo.diametro * 2)}" fill="none" stroke="#c97f12" stroke-width="${n2(estribo.diametro)}"/>`;
    cotas =
      cotaHorizontal(0, ancho, alto + cota, `b = ${formatear(seccion.b, 0)} cm`, fuente, trazo) +
      cotaVertical(0, alto, -cota, `h = ${formatear(seccion.h, 0)} cm`, fuente, trazo);
  }

  const barrasSvg = geometria.posiciones
    .map((p) => `<circle cx="${n2(p.x)}" cy="${n2(p.y)}" r="${n2(varilla.diametro / 2)}" fill="#1b242d" stroke="#f2a93b" stroke-width="${n2(trazo * 0.8)}"/>`)
    .join('');

  return `<svg viewBox="${viewBox}" role="img" aria-label="${descripcion}" xmlns="http://www.w3.org/2000/svg">
    <title>${descripcion}</title>
    ${concreto}${estriboSvg}${barrasSvg}${cotas}
  </svg>`;
}

/** Línea de cota horizontal con extremos y texto centrado debajo. */
function cotaHorizontal(x0, x1, y, texto, fuente, trazo) {
  const tick = fuente * 0.45;
  return `<g stroke="currentColor" stroke-width="${n2(trazo)}" fill="currentColor">
    <line x1="${n2(x0)}" y1="${n2(y)}" x2="${n2(x1)}" y2="${n2(y)}"/>
    <line x1="${n2(x0)}" y1="${n2(y - tick)}" x2="${n2(x0)}" y2="${n2(y + tick)}"/>
    <line x1="${n2(x1)}" y1="${n2(y - tick)}" x2="${n2(x1)}" y2="${n2(y + tick)}"/>
    <text x="${n2((x0 + x1) / 2)}" y="${n2(y + fuente * 1.25)}" font-size="${n2(fuente)}" text-anchor="middle" stroke="none" font-family="system-ui, sans-serif">${texto}</text>
  </g>`;
}

/** Línea de cota vertical (a la izquierda) con texto girado. */
function cotaVertical(y0, y1, x, texto, fuente, trazo) {
  const tick = fuente * 0.45;
  const tx = x - fuente * 0.6, ty = (y0 + y1) / 2;
  return `<g stroke="currentColor" stroke-width="${n2(trazo)}" fill="currentColor">
    <line x1="${n2(x)}" y1="${n2(y0)}" x2="${n2(x)}" y2="${n2(y1)}"/>
    <line x1="${n2(x - tick)}" y1="${n2(y0)}" x2="${n2(x + tick)}" y2="${n2(y0)}"/>
    <line x1="${n2(x - tick)}" y1="${n2(y1)}" x2="${n2(x + tick)}" y2="${n2(y1)}"/>
    <text x="${n2(tx)}" y="${n2(ty)}" font-size="${n2(fuente)}" text-anchor="middle" stroke="none" font-family="system-ui, sans-serif" transform="rotate(-90 ${n2(tx)} ${n2(ty)})">${texto}</text>
  </g>`;
}

/* ================================================================
   4. Pintado del resultado
   ================================================================ */

function textoDistribucion(r) {
  const { seccion, geometria, barras, tipo } = r;
  const frases = [];

  if (seccion.circular) {
    frases.push(
      `${barras.n} varillas repartidas uniformemente en el perímetro, sobre un círculo de ` +
      `${formatear(2 * geometria.radioBarras, 1)} cm de diámetro.`,
    );
  } else if (barras.n === 4) {
    frases.push('Una varilla en cada esquina.');
  } else {
    const { caraB, caraH } = geometria.caras;
    frases.push(
      `${caraB} varillas en cada cara de ${formatear(seccion.b, 0)} cm y ${caraH} en cada cara de ` +
      `${formatear(seccion.h, 0)} cm (las 4 de esquina se comparten).`,
    );
  }

  if (barras.motivo === 'minimo') {
    frases.push(`Por área bastaban ${barras.teorico}; se coloca el mínimo de ${tipo.minBarras} barras (E.060 10.9.2).`);
  } else if (barras.motivo === 'simetria') {
    frases.push(`Por área bastaban ${barras.teorico}; se redondea a ${barras.n} para un armado simétrico.`);
  }

  return frases.join(' ');
}

function fila(dt, dd, clase) {
  const t = document.createElement('dt');
  t.textContent = dt;
  const d = document.createElement('dd');
  d.textContent = dd;
  if (clase) d.classList.add(clase);
  return [t, d];
}

function pintarDetalles(r) {
  const { seccion, acero, barras, varilla, estribo, geometria, capacidad, tipo, materiales } = r;
  const s = geometria.separacion;
  const filas = [];

  filas.push(...fila(
    'Sección',
    seccion.circular
      ? `D = ${formatear(seccion.D, 0)} cm · ${tipo.nombre.toLowerCase()}`
      : `${formatear(seccion.b, 0)} × ${formatear(seccion.h, 0)} cm · ${tipo.nombre.toLowerCase()}`,
  ));
  filas.push(...fila('Materiales', `f'c = ${formatear(materiales.fc, 0)} · fy = ${formatear(materiales.fy, 0)} kg/cm²`));
  filas.push(...fila('Área bruta Ag', `${formatear(seccion.ag, 2)} cm²`));

  const origen = { cuantia: 'por cuantía', carga: 'por carga Pu', minima: 'mínimo normativo 1 %' }[acero.gobierna];
  filas.push(...fila('Acero requerido As', `${formatear(acero.asRequerido, 2)} cm² · ρ = ${porcentaje(acero.cuantiaRequerida)} % (${origen})`));
  if (acero.gobierna === 'minima') {
    filas.push(...fila('As que pide la carga', `${formatear(Math.max(acero.cuantiaCalculada, 0) * seccion.ag, 2)} cm² · ρ = ${porcentaje(Math.max(acero.cuantiaCalculada, 0))} %`));
  }
  filas.push(...fila('Acero colocado', `${barras.n} × ${formatear(varilla.area, 2)} = ${formatear(acero.asColocado, 2)} cm² · ρ = ${porcentaje(acero.cuantiaColocada)} %`));

  const sepTexto = seccion.circular
    ? `${formatear(s.libre, 1)} cm`
    : `${formatear(s.libreB, 1)} cm (cara b) · ${formatear(s.libreH, 1)} cm (cara h)`;
  filas.push(...fila('Separación libre', `${sepTexto} · mín. ${formatear(s.minima, 1)} cm ${s.cumple ? '✓' : '✗'}`, s.cumple ? 'ok' : 'mal'));

  let resistencia = `${formatear(capacidad.phiPn, 1)} tonf`;
  if (capacidad.pu !== null) resistencia += ` ${capacidad.cumple ? '≥' : '<'} Pu = ${formatear(capacidad.pu, 1)} tonf ${capacidad.cumple ? '✓' : '✗'}`;
  filas.push(...fila('Resistencia axial φPn,máx', resistencia, capacidad.pu === null ? '' : capacidad.cumple ? 'ok' : 'mal'));

  filas.push(...fila('Estribos', `${estribo.nombre} (E.060 7.10.5.1) · recubrimiento ${formatear(r.recubrimiento, 1)} cm`));

  $('res-detalles').replaceChildren(...filas);
}

function pintarAlternativas(alternativas) {
  const filas = alternativas.map((a) => {
    const tr = document.createElement('tr');
    if (a.actual) tr.classList.add('actual');

    const celdas = [
      a.varilla.nombre + (a.actual ? ' (elegida)' : ''),
      String(a.n),
      formatear(a.asColocado, 2),
      porcentaje(a.cuantia),
    ];
    for (const texto of celdas) {
      const td = document.createElement('td');
      td.textContent = texto;
      tr.append(td);
    }

    const estado = document.createElement('td');
    if (!a.cumpleCuantia) { estado.textContent = '✗ ρ > 6 %'; estado.className = 'mal'; }
    else if (!a.cumpleSeparacion) { estado.textContent = '✗ Muy juntas'; estado.className = 'mal'; }
    else { estado.textContent = '✓ Cumple'; estado.className = 'ok'; }
    tr.append(estado);
    return tr;
  });
  $('res-alternativas').replaceChildren(...filas);
}

function pintarResultado(r) {
  $('res-n').textContent = String(r.barras.n);
  $('res-varilla').textContent = r.varilla.nombre;
  $('res-distribucion').textContent = textoDistribucion(r);
  $('res-estribo').textContent = `Con estribos de ${r.estribo.nombre} y recubrimiento de ${formatear(r.recubrimiento, 1)} cm.`;
  $('res-diagrama').innerHTML = dibujarSeccion(r);

  pintarDetalles(r);

  const bloque = $('bloque-advertencias');
  const lista = $('res-advertencias');
  lista.replaceChildren(...r.advertencias.map((texto) => {
    const li = document.createElement('li');
    li.textContent = texto;
    return li;
  }));
  bloque.hidden = r.advertencias.length === 0;

  pintarAlternativas(r.alternativas);

  vacio.hidden = true;
  resultado.hidden = false;

  publicarUltimoCalculo(r);
}

function mostrarVacio() {
  resultado.hidden = true;
  vacio.hidden = false;
}

/* ================================================================
   5. Widget «Último cálculo»
   ================================================================ */

/** Datos planos que enlaza la plantilla widgets/ultimo-calculo-plantilla.json. */
function construirDatosWidget(r) {
  const ahora = new Date();
  const medidas = r.seccion.circular
    ? `D = ${formatear(r.seccion.D, 0)} cm`
    : `${formatear(r.seccion.b, 0)} × ${formatear(r.seccion.h, 0)} cm`;
  return {
    hayCalculo: true,
    n: r.barras.n,
    varilla: r.varilla.nombre,
    seccion: `${medidas} · ${r.tipo.nombre.toLowerCase()}`,
    distribucion: textoDistribucion(r),
    estribo: r.estribo.nombre,
    recubrimiento: formatear(r.recubrimiento, 1),
    cuantia: porcentaje(r.acero.cuantiaColocada),
    actualizado: ahora.toISOString(),
    actualizadoTexto: `Calculado el ${ahora.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}`,
    urlApp: './',
  };
}

/** Persiste el último cálculo y se lo entrega al service worker para el widget. */
function publicarUltimoCalculo(r) {
  const datos = construirDatosWidget(r);
  try { localStorage.setItem(CLAVE_ULTIMO_CALCULO, JSON.stringify(datos)); } catch { /* modo privado */ }
  enviarDatosWidget(TAG_WIDGET, datos);
}

/** En cada carga siembra el SW con el último cálculo guardado (no restaura el formulario). */
function sembrarWidget() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_ULTIMO_CALCULO) ?? 'null');
    if (datos?.hayCalculo) enviarDatosWidget(TAG_WIDGET, datos);
  } catch { /* sin cálculos previos o JSON corrupto */ }
}

/* ================================================================
   6. Eventos
   ================================================================ */

form.addEventListener('change', (evento) => {
  if (evento.target.name === 'tipo' || evento.target.name === 'metodo') sincronizarGrupos();
});

form.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const r = calcularColumna(leerEntrada());
  if (!r.ok) {
    mostrarErrores(r.errores);
    return;
  }
  limpiarErrores();
  pintarResultado(r);

  // En pantallas angostas el resultado queda debajo del formulario.
  if (window.matchMedia('(max-width: 899px)').matches) {
    $('panel-resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

form.addEventListener('reset', () => {
  // Los valores vuelven a los predeterminados después de este evento.
  setTimeout(() => {
    sincronizarGrupos();
    limpiarErrores();
    mostrarVacio();
  }, 0);
});

llenarVarillas();
sincronizarGrupos();
sembrarWidget();
