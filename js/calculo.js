/* ==========================================================================
   Calculadora de Varillas · Lógica de cálculo (sin DOM)
   --------------------------------------------------------------------------
   Refuerzo longitudinal de columnas de concreto armado según la NTP E.060
   "Concreto Armado" (Perú), concordante con ACI 318.

     - Cuantía del refuerzo longitudinal:  1 % ≤ ρ ≤ 6 %            (E.060 10.9.1)
     - Número mínimo de barras: 4 con estribos, 6 con espiral       (E.060 10.9.2)
     - Resistencia máxima a compresión axial                        (E.060 10.3.6)
         estribos: φPn,máx = 0,80 φ [0,85 f'c (Ag − Ast) + fy Ast]   φ = 0,70
         espiral:  φPn,máx = 0,85 φ [0,85 f'c (Ag − Ast) + fy Ast]   φ = 0,75
     - Separación libre mínima entre barras: 1,5 db y 4 cm          (E.060 7.6.3)
     - Recubrimiento mínimo en columnas: 4 cm                        (E.060 7.7.1)
     - Estribos: 3/8" para barras ≤ 1", 1/2" para barras mayores    (E.060 7.10.5.1)
     - Dimensión mínima en columnas sismorresistentes: 25 cm        (E.060 21.4.1)

   Unidades de entrada y salida: cm, cm², kg/cm² y tonf.
   Este módulo no toca el DOM para poder probarse en Node.
   ========================================================================== */

/** Varillas corrugadas de uso común en columnas (áreas nominales ASTM). */
export const VARILLAS = [
  { id: '3/8',   nombre: '3/8"',   diametro: 0.95, area: 0.71 },
  { id: '1/2',   nombre: '1/2"',   diametro: 1.27, area: 1.29 },
  { id: '5/8',   nombre: '5/8"',   diametro: 1.59, area: 2.00 },
  { id: '3/4',   nombre: '3/4"',   diametro: 1.91, area: 2.84 },
  { id: '1',     nombre: '1"',     diametro: 2.54, area: 5.10 },
  { id: '1-3/8', nombre: '1 3/8"', diametro: 3.58, area: 10.06 },
];

/** Estribos posibles; el diámetro se elige según la barra longitudinal. */
export const ESTRIBOS = [
  { id: '3/8', nombre: '3/8"', diametro: 0.95 },
  { id: '1/2', nombre: '1/2"', diametro: 1.27 },
];

/** Tipos de columna: φ y α (E.060 9.3.2.2 y 10.3.6) y barras mínimas (10.9.2). */
export const TIPOS = {
  rectangular: { id: 'rectangular', nombre: 'Rectangular con estribos', circular: false, phi: 0.70, alfa: 0.80, minBarras: 4 },
  circular:    { id: 'circular',    nombre: 'Circular con estribos',    circular: true,  phi: 0.70, alfa: 0.80, minBarras: 4 },
  espiral:     { id: 'espiral',     nombre: 'Circular con espiral',     circular: true,  phi: 0.75, alfa: 0.85, minBarras: 6 },
};

export const CUANTIA_MIN = 0.01;          // E.060 10.9.1
export const CUANTIA_MAX = 0.06;          // E.060 10.9.1
export const CUANTIA_RECOMENDADA = 0.04;  // por facilidad constructiva (empalmes)
export const RECUBRIMIENTO_MIN = 4;       // cm, E.060 7.7.1
export const DIMENSION_MIN_SISMICA = 25;  // cm, E.060 21.4.1
export const FC_MIN_SISMICO = 210;        // kg/cm², E.060 21.3.1

const EPS = 1e-9;

/** Formatea un número con la convención local (es-PE: 1,500.25). */
const formateadores = new Map();
export function formatear(valor, decimales = 2) {
  if (!formateadores.has(decimales)) {
    formateadores.set(decimales, new Intl.NumberFormat('es-PE', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }));
  }
  return formateadores.get(decimales).format(valor);
}

/** Cuantía (fracción) como porcentaje con dos decimales: 0.0107 → "1.07". */
export const porcentaje = (cuantia) => formatear(cuantia * 100, 2);

export const buscarVarilla = (id) => VARILLAS.find((v) => v.id === id);

/** Estribo mínimo según el diámetro de la barra longitudinal (E.060 7.10.5.1). */
export function estriboPara(varilla) {
  return varilla.diametro <= 2.54 ? ESTRIBOS[0] : ESTRIBOS[1];
}

/** Separación libre mínima entre barras longitudinales (E.060 7.6.3). */
export const separacionMinima = (varilla) => Math.max(1.5 * varilla.diametro, 4);

/* ==========================================================================
   Validación de la entrada
   ========================================================================== */

const esPositivo = (x) => Number.isFinite(x) && x > 0;

/**
 * Devuelve la lista de errores de la entrada ([] si es válida).
 * Cada error indica el campo para que la interfaz lo marque.
 */
export function validar(entrada) {
  const errores = [];
  const tipo = TIPOS[entrada.tipo];

  if (!tipo) errores.push({ campo: 'tipo', mensaje: 'Elige el tipo de columna.' });

  if (tipo?.circular) {
    if (!esPositivo(entrada.D)) errores.push({ campo: 'D', mensaje: 'Ingresa el diámetro de la columna en cm.' });
  } else if (tipo) {
    if (!esPositivo(entrada.b)) errores.push({ campo: 'b', mensaje: 'Ingresa el ancho b en cm.' });
    if (!esPositivo(entrada.h)) errores.push({ campo: 'h', mensaje: 'Ingresa el peralte h en cm.' });
  }

  if (!esPositivo(entrada.fc)) errores.push({ campo: 'fc', mensaje: "Ingresa la resistencia del concreto f'c en kg/cm²." });
  if (!esPositivo(entrada.fy)) errores.push({ campo: 'fy', mensaje: 'Ingresa la fluencia del acero fy en kg/cm².' });
  if (esPositivo(entrada.fc) && esPositivo(entrada.fy) && entrada.fy <= 0.85 * entrada.fc) {
    errores.push({ campo: 'fy', mensaje: "fy debe ser mayor que 0,85·f'c." });
  }

  if (entrada.metodo === 'cuantia') {
    const rho = entrada.cuantia;
    if (!Number.isFinite(rho) || rho < CUANTIA_MIN * 100 - EPS || rho > CUANTIA_MAX * 100 + EPS) {
      errores.push({ campo: 'cuantia', mensaje: 'La cuantía debe estar entre 1 % y 6 % (E.060 10.9.1).' });
    }
  } else if (entrada.metodo === 'carga') {
    if (!esPositivo(entrada.pu)) errores.push({ campo: 'pu', mensaje: 'Ingresa la carga axial última Pu en tonf.' });
  } else {
    errores.push({ campo: 'metodo', mensaje: 'Elige el método de cálculo.' });
  }

  if (!buscarVarilla(entrada.varilla)) errores.push({ campo: 'varilla', mensaje: 'Elige el diámetro de la varilla.' });

  if (!Number.isFinite(entrada.recubrimiento) || entrada.recubrimiento < 0) {
    errores.push({ campo: 'recubrimiento', mensaje: 'Ingresa el recubrimiento en cm (0 o más).' });
  }

  return errores;
}

/* ==========================================================================
   Número de barras
   ========================================================================== */

/**
 * Barras necesarias para cubrir `asRequerido` con la varilla dada.
 * Aplica el mínimo normativo y, en secciones rectangulares, redondea a un
 * número par para que el armado sea simétrico (mismas barras en caras opuestas).
 */
export function numeroBarras(asRequerido, varilla, tipo) {
  const teorico = Math.max(1, Math.ceil(asRequerido / varilla.area - EPS));
  let n = teorico;
  let motivo = 'calculo';

  if (n < tipo.minBarras) { n = tipo.minBarras; motivo = 'minimo'; }
  if (!tipo.circular && n % 2 === 1) { n += 1; motivo = motivo === 'minimo' ? 'minimo' : 'simetria'; }

  return { n, teorico, motivo };
}

/* ==========================================================================
   Distribución en la sección y separación libre
   ========================================================================== */

/**
 * Ubica las barras en la sección y calcula la separación libre entre ellas.
 * Las coordenadas están en cm, con origen en la esquina superior izquierda
 * (rectangular) o en el vértice del cuadrado que circunscribe al círculo.
 */
export function distribuir(seccion, n, varilla, estribo, recubrimiento) {
  const db = varilla.diametro;
  const margen = recubrimiento + estribo.diametro + db / 2; // borde → centro de barra
  const minima = separacionMinima(varilla);

  if (seccion.circular) {
    const radio = seccion.D / 2 - margen;
    const centro = seccion.D / 2;
    const posiciones = Array.from({ length: n }, (_, k) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * k) / n;
      return { x: centro + radio * Math.cos(ang), y: centro + radio * Math.sin(ang) };
    });
    const libre = 2 * radio * Math.sin(Math.PI / n) - db;
    return {
      circular: true,
      posiciones,
      radioBarras: radio,
      separacion: { minima, libre, cumple: libre >= minima - EPS },
    };
  }

  const { b, h } = seccion;
  const x0 = margen, x1 = b - margen;
  const y0 = margen, y1 = h - margen;

  // Barras intermedias (sin esquinas) por cada par de caras opuestas,
  // repartidas en proporción a la longitud de la cara.
  const intermedias = (n - 4) / 2;
  let enCaraH = Math.min(intermedias, Math.round((intermedias * h) / (b + h)));
  let enCaraB = intermedias - enCaraH;
  const caraB = 2 + enCaraB; // barras en cada cara de longitud b (incluye esquinas)
  const caraH = 2 + enCaraH; // barras en cada cara de longitud h (incluye esquinas)

  const posiciones = [];
  for (let i = 0; i < caraB; i++) {
    const x = x0 + ((x1 - x0) * i) / (caraB - 1);
    posiciones.push({ x, y: y0 }, { x, y: y1 });
  }
  for (let j = 1; j < caraH - 1; j++) {
    const y = y0 + ((y1 - y0) * j) / (caraH - 1);
    posiciones.push({ x: x0, y }, { x: x1, y });
  }

  const libreB = (x1 - x0) / (caraB - 1) - db;
  const libreH = (y1 - y0) / (caraH - 1) - db;

  return {
    circular: false,
    posiciones,
    caras: { caraB, caraH },
    separacion: {
      minima,
      libreB,
      libreH,
      libre: Math.min(libreB, libreH),
      cumple: libreB >= minima - EPS && libreH >= minima - EPS,
    },
  };
}

/* ==========================================================================
   Resistencia axial
   ========================================================================== */

/** φPn,máx en tonf para compresión axial pura (E.060 10.3.6). */
export function resistenciaAxial(tipo, ag, ast, fc, fy) {
  return (tipo.alfa * tipo.phi * (0.85 * fc * (ag - ast) - fy * ast)) / 1000;
}

/* ==========================================================================
   Cálculo completo
   ========================================================================== */

/**
 * @param {object} entrada
 *   tipo: 'rectangular' | 'circular' | 'espiral'
 *   b, h (cm) para rectangular · D (cm) para circular
 *   fc, fy (kg/cm²)
 *   metodo: 'cuantia' (cuantia en %) | 'carga' (pu en tonf)
 *   varilla: id de VARILLAS · recubrimiento (cm)
 * @returns {object} { ok, errores, advertencias, ...resultado }
 */
export function calcularColumna(entrada) {
  const errores = validar(entrada);
  if (errores.length > 0) return { ok: false, errores, advertencias: [] };

  const tipo = TIPOS[entrada.tipo];
  const varilla = buscarVarilla(entrada.varilla);
  const estribo = estriboPara(varilla);
  const { fc, fy, recubrimiento } = entrada;

  const seccion = tipo.circular
    ? { circular: true, D: entrada.D, ag: (Math.PI * entrada.D ** 2) / 4 }
    : { circular: false, b: entrada.b, h: entrada.h, ag: entrada.b * entrada.h };
  const { ag } = seccion;

  /* --- 1. Acero requerido -------------------------------------------- */
  let asRequerido;
  let cuantiaCalculada; // la que pide el método, antes de aplicar mínimos
  let gobierna;         // 'cuantia' | 'carga' | 'minima'

  if (entrada.metodo === 'cuantia') {
    cuantiaCalculada = entrada.cuantia / 100;
    asRequerido = cuantiaCalculada * ag;
    gobierna = 'cuantia';
  } else {
    // Pu = φ α [0,85 f'c (Ag − Ast) + fy Ast]  →  Ast
    const pnRequerido = (entrada.pu * 1000) / (tipo.phi * tipo.alfa);
    const ast = (pnRequerido - 0.85 * fc * ag) / (fy - 0.85 * fc);
    cuantiaCalculada = ast / ag;

    if (cuantiaCalculada > CUANTIA_MAX + EPS) {
      return {
        ok: false,
        advertencias: [],
        errores: [{
          campo: 'pu',
          mensaje:
            `La carga exige una cuantía de ${porcentaje(cuantiaCalculada)} %, mayor que el máximo ` +
            `de 6 % (E.060 10.9.1). Aumenta las dimensiones de la columna o la resistencia f'c.`,
        }],
      };
    }

    if (ast < CUANTIA_MIN * ag) {
      asRequerido = CUANTIA_MIN * ag;
      gobierna = 'minima';
    } else {
      asRequerido = ast;
      gobierna = 'carga';
    }
  }
  const cuantiaRequerida = asRequerido / ag;

  /* --- 2. Número de barras -------------------------------------------- */
  const barras = numeroBarras(asRequerido, varilla, tipo);
  const asColocado = barras.n * varilla.area;
  const cuantiaColocada = asColocado / ag;

  /* --- 3. Distribución y separación ----------------------------------- */
  const geometria = distribuir(seccion, barras.n, varilla, estribo, recubrimiento);

  /* --- 4. Resistencia con el acero colocado --------------------------- */
  const phiPn = resistenciaAxial(tipo, ag, asColocado, fc, fy);
  const capacidad = {
    phiPn,
    pu: entrada.metodo === 'carga' ? entrada.pu : null,
    cumple: entrada.metodo === 'carga' ? phiPn >= entrada.pu - EPS : null,
  };

  /* --- 5. Advertencias ------------------------------------------------ */
  const advertencias = [];
  const fmtPct = porcentaje;
  const fmt = (x) => formatear(x, 1);

  if (cuantiaColocada > CUANTIA_MAX + EPS) {
    advertencias.push(
      `La cuantía colocada (${fmtPct(cuantiaColocada)} %) supera el máximo de 6 % (E.060 10.9.1). ` +
      'Usa un diámetro menor o aumenta la sección.',
    );
  } else if (cuantiaColocada > CUANTIA_RECOMENDADA + EPS) {
    advertencias.push(
      `La cuantía colocada (${fmtPct(cuantiaColocada)} %) es mayor que 4 %: los empalmes se congestionan. ` +
      'Considera aumentar la sección.',
    );
  }

  if (!geometria.separacion.cumple) {
    advertencias.push(
      `La separación libre entre barras (${fmt(geometria.separacion.libre)} cm) es menor que la mínima de ` +
      `${fmt(geometria.separacion.minima)} cm (E.060 7.6.3). Usa un diámetro mayor (menos barras) o aumenta la sección.`,
    );
  }

  const dimensionMenor = seccion.circular ? seccion.D : Math.min(seccion.b, seccion.h);
  if (dimensionMenor < DIMENSION_MIN_SISMICA - EPS) {
    advertencias.push(
      `La dimensión menor (${fmt(dimensionMenor)} cm) es menor que 25 cm, el mínimo para columnas ` +
      'sismorresistentes (E.060 21.4.1).',
    );
  }

  if (recubrimiento < RECUBRIMIENTO_MIN - EPS) {
    advertencias.push(`El recubrimiento (${fmt(recubrimiento)} cm) es menor que el mínimo de 4 cm para columnas (E.060 7.7.1).`);
  }

  if (fc < FC_MIN_SISMICO - EPS) {
    advertencias.push(`f'c = ${fmt(fc)} kg/cm² es menor que 210 kg/cm², el mínimo en elementos sismorresistentes (E.060 21.3.1).`);
  }

  if (entrada.metodo === 'carga') {
    advertencias.push(
      'El cálculo por carga considera compresión axial pura (Pn,máx). Si la columna recibe momentos, ' +
      'verifica el diseño con el diagrama de interacción P–M.',
    );
  }

  /* --- 6. Alternativas con otros diámetros ---------------------------- */
  const alternativas = VARILLAS.map((v) => {
    const nb = numeroBarras(asRequerido, v, tipo);
    const geo = distribuir(seccion, nb.n, v, estriboPara(v), recubrimiento);
    const as = nb.n * v.area;
    return {
      varilla: v,
      n: nb.n,
      asColocado: as,
      cuantia: as / ag,
      cumpleSeparacion: geo.separacion.cumple,
      cumpleCuantia: as / ag <= CUANTIA_MAX + EPS,
      actual: v.id === varilla.id,
    };
  });

  return {
    ok: true,
    errores: [],
    advertencias,
    tipo,
    seccion,
    materiales: { fc, fy },
    metodo: entrada.metodo,
    varilla,
    estribo,
    recubrimiento,
    acero: { asRequerido, cuantiaRequerida, cuantiaCalculada, gobierna, asColocado, cuantiaColocada },
    barras,
    geometria,
    capacidad,
    alternativas,
  };
}
