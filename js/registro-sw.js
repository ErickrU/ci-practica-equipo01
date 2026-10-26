// Registro del service worker y capacidades de la interfaz PWA.
import { crearPanelWidgets } from './widgets.js';

const raiz = document.documentElement;
const metaTema = document.querySelector('meta[name="theme-color"]');
const estadoSw = document.getElementById('estado-sw');
const toast = document.getElementById('toast-actualizacion');
const btnRecargar = document.getElementById('btn-recargar');
const btnInstalar = document.getElementById('control-instalar');
const btnCompartir = document.getElementById('control-compartir');
const btnTema = document.getElementById('control-tema');
const btnRestablecer = document.getElementById('control-restablecer');
const btnAyuda = document.getElementById('control-ayuda');
const dialogoAyuda = document.getElementById('dialogo-ayuda');
const btnCerrarAyuda = document.getElementById('cerrar-ayuda');
const chipConexion = document.getElementById('chip-conexion');

let promptInstalacion = null;
let focoAntesDelDialogo = null;
let temporizadorGeometria = null;

const anunciar = (texto) => { if (estadoSw) estadoSw.textContent = texto; };
const informar = (texto) => anunciar(texto ? `Service worker: ${texto}` : '');

/* ================================================================
   1. Service worker
   ================================================================ */
if (!('serviceWorker' in navigator)) {
  informar('no soportado en este navegador');
} else {
  // Solo recargamos si NOSOTROS pedimos activar la versión nueva. En la primera
  // visita clients.claim() también dispara controllerchange y recargar ahí
  // sería un parpadeo gratuito.
  let saltoSolicitado = false;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!saltoSolicitado || recargando) return;
    recargando = true;
    location.reload();
  });

  /** Un SW "esperando" solo es una actualización real si ya había otro controlando. */
  function revisarEspera(registro) {
    if (!registro.waiting || !navigator.serviceWorker.controller) return;
    informar('nueva versión lista');
    if (!toast || !btnRecargar) return;
    toast.hidden = false;
    btnRecargar.onclick = () => {
      btnRecargar.disabled = true;
      saltoSolicitado = true;
      registro.waiting.postMessage({ tipo: 'SALTAR_ESPERA' });
    };
  }

  window.addEventListener('load', async () => {
    try {
      const registro = await navigator.serviceWorker.register('./sw.js');
      informar(registro.active ? 'activo · disponible sin conexión' : 'instalando…');

      revisarEspera(registro);
      registro.addEventListener('updatefound', () => {
        const nuevo = registro.installing;
        nuevo?.addEventListener('statechange', () => {
          if (nuevo.state === 'installed') {
            if (navigator.serviceWorker.controller) revisarEspera(registro);
            else informar('activo · disponible sin conexión');
          }
        });
      });
    } catch (error) {
      console.error('[SW] no se pudo registrar:', error);
      informar('no se pudo registrar');
    }
  });
}

/* ================================================================
   2. Instalación
   ================================================================ */
function estaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function actualizarInstalacion() {
  if (!btnInstalar || !estaInstalada()) return;
  btnInstalar.setAttribute('aria-label', 'Aplicación instalada');
  btnInstalar.title = 'Aplicación instalada';
  btnInstalar.querySelector('span').textContent = 'Instalada';
}

window.addEventListener('beforeinstallprompt', (evento) => {
  evento.preventDefault();
  promptInstalacion = evento;
  anunciar('La calculadora está lista para instalarse.');
});

btnInstalar?.addEventListener('click', async () => {
  if (estaInstalada()) {
    anunciar('La calculadora ya está instalada en este dispositivo.');
    return;
  }
  if (!promptInstalacion) {
    anunciar('Usa la opción «Instalar aplicación» del menú de tu navegador.');
    return;
  }

  btnInstalar.disabled = true;
  try {
    await promptInstalacion.prompt();
    const eleccion = await promptInstalacion.userChoice;
    anunciar(eleccion.outcome === 'accepted' ? 'Instalación aceptada.' : 'Instalación cancelada.');
  } finally {
    promptInstalacion = null;
    btnInstalar.disabled = false;
  }
});

window.addEventListener('appinstalled', () => {
  promptInstalacion = null;
  actualizarInstalacion();
  anunciar('La calculadora se instaló correctamente.');
});

/* ================================================================
   3. Compartir, tema, restablecer y ayuda
   ================================================================ */
async function copiarEnlace() {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(window.location.href);
    return;
  }

  const campo = document.createElement('textarea');
  campo.value = window.location.href;
  campo.setAttribute('readonly', '');
  campo.style.position = 'fixed';
  campo.style.opacity = '0';
  document.body.append(campo);
  campo.select();
  const copiado = document.execCommand('copy');
  campo.remove();
  if (!copiado) throw new Error('No se pudo copiar el enlace');
}

btnCompartir?.addEventListener('click', async () => {
  try {
    if (navigator.share) {
      await navigator.share({
        title: document.title,
        text: 'Calcula el refuerzo longitudinal de columnas de concreto armado.',
        url: window.location.href,
      });
      anunciar('La calculadora se compartió correctamente.');
    } else {
      await copiarEnlace();
      anunciar('Enlace copiado al portapapeles.');
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    try {
      await copiarEnlace();
      anunciar('Enlace copiado al portapapeles.');
    } catch {
      anunciar('No se pudo compartir. Copia la dirección desde el navegador.');
    }
  }
});

function aplicarTema(tema, guardar = true) {
  raiz.dataset.tema = tema;
  metaTema.content = tema === 'claro' ? '#f4f6f8' : '#101820';
  btnTema?.setAttribute('aria-pressed', String(tema === 'claro'));
  if (btnTema) {
    btnTema.setAttribute('aria-label', tema === 'claro' ? 'Usar tema oscuro' : 'Usar tema claro');
    btnTema.title = tema === 'claro' ? 'Usar tema oscuro' : 'Usar tema claro';
  }
  if (guardar) localStorage.setItem('calculadora-varillas-tema', tema);
}

const temaGuardado = localStorage.getItem('calculadora-varillas-tema');
aplicarTema(temaGuardado === 'claro' ? 'claro' : 'oscuro', false);
btnTema?.addEventListener('click', () => {
  const tema = raiz.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
  aplicarTema(tema);
  anunciar(`Tema ${tema} activado.`);
});

btnRestablecer?.addEventListener('click', () => {
  document.getElementById('form-columna')?.reset();
  anunciar('Formulario restablecido a sus valores iniciales.');
});

function abrirAyuda() {
  focoAntesDelDialogo = document.activeElement;
  dialogoAyuda.showModal();
  btnCerrarAyuda.focus();
}

btnAyuda?.addEventListener('click', abrirAyuda);
btnCerrarAyuda?.addEventListener('click', () => dialogoAyuda.close());
dialogoAyuda?.addEventListener('click', (evento) => {
  if (evento.target === dialogoAyuda) dialogoAyuda.close();
});
dialogoAyuda?.addEventListener('close', () => {
  if (focoAntesDelDialogo?.isConnected) focoAntesDelDialogo.focus();
});

/* ================================================================
   4. Window Controls Overlay
   ================================================================ */
function sincronizarWco() {
  const wco = navigator.windowControlsOverlay;
  if (!wco) {
    document.body.classList.remove('wco-visible', 'wco-angosto');
    document.body.dataset.wco = 'no-disponible';
    return;
  }

  const rectangulo = wco.getTitlebarAreaRect();
  document.body.classList.toggle('wco-visible', wco.visible);
  document.body.classList.toggle('wco-angosto', wco.visible && rectangulo.width < 720);
  document.body.dataset.wco = wco.visible ? 'visible' : 'oculto';
  document.body.dataset.wcoAncho = String(Math.round(rectangulo.width));
}

sincronizarWco();
if (navigator.windowControlsOverlay) {
  navigator.windowControlsOverlay.addEventListener('geometrychange', () => {
    clearTimeout(temporizadorGeometria);
    temporizadorGeometria = setTimeout(sincronizarWco, 200);
  });
}

/* ================================================================
   5. Estado de la conexión
   ================================================================ */
function actualizarConexion() {
  if (!chipConexion) return;
  const enLinea = navigator.onLine;
  chipConexion.dataset.estado = enLinea ? 'en-linea' : 'sin-conexion';
  chipConexion.querySelector('.chip__texto').textContent = enLinea ? 'En línea' : 'Sin conexión · la calculadora sigue funcionando';
}
window.addEventListener('online', actualizarConexion);
window.addEventListener('offline', actualizarConexion);
actualizarConexion();
actualizarInstalacion();

/* ================================================================
   6. Panel de widgets
   ----------------------------------------------------------------
   Simulación del Widgets Board de Windows 11: el sexto control abre un
   <dialog> que pinta el widget «Último cálculo» con la misma plantilla
   (ms_ac_template) y los mismos datos que usaría Microsoft Edge.
   ================================================================ */
crearPanelWidgets({
  boton: document.getElementById('control-widgets'),
  anunciar,
  claveAlmacen: 'calculadora-varillas:widgets-instalados',
});
