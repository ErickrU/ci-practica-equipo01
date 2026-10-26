/* ==========================================================================
   Pruebas unitarias del motor de cálculo (js/calculo.js)
   --------------------------------------------------------------------------
   Se ejecutan con el test runner nativo de Node (>= 20), sin dependencias:

       npm test        →  node --test

   Los valores esperados provienen de docs/CALCULATIONS.md (ejemplo
   reproducible) y de la NTP E.060, de modo que un cambio accidental en una
   fórmula haga fallar la integración continua antes de llegar a `main`.
   ========================================================================== */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  VARILLAS,
  ESTRIBOS,
  TIPOS,
  buscarVarilla,
  estriboPara,
  separacionMinima,
  validar,
  numeroBarras,
  distribuir,
  resistenciaAxial,
  calcularColumna,
} from '../js/calculo.js';

/** Entrada base: el ejemplo reproducible de la documentación. */
const ENTRADA_EJEMPLO = {
  tipo: 'rectangular',
  b: 30,
  h: 50,
  fc: 210,
  fy: 4200,
  metodo: 'cuantia',
  cuantia: 1,
  varilla: '5/8',
  recubrimiento: 4,
};

/** Compara números reales con una tolerancia absoluta. */
const casiIgual = (real, esperado, tolerancia = 1e-6, mensaje) =>
  assert.ok(Math.abs(real - esperado) <= tolerancia, mensaje ?? `${real} ≠ ${esperado} (±${tolerancia})`);

describe('catálogo de varillas y estribos', () => {
  test('buscarVarilla devuelve la varilla por id y undefined si no existe', () => {
    assert.equal(buscarVarilla('5/8').area, 2.0);
    assert.equal(buscarVarilla('1').diametro, 2.54);
    assert.equal(buscarVarilla('7/8'), undefined);
  });

  test('estriboPara: 3/8" hasta barras de 1" y 1/2" para barras mayores (E.060 7.10.5.1)', () => {
    assert.equal(estriboPara(buscarVarilla('3/8')), ESTRIBOS[0]);
    assert.equal(estriboPara(buscarVarilla('1')), ESTRIBOS[0]);
    assert.equal(estriboPara(buscarVarilla('1-3/8')), ESTRIBOS[1]);
  });

  test('separacionMinima es el mayor entre 1,5·db y 4 cm (E.060 7.6.3)', () => {
    assert.equal(separacionMinima(buscarVarilla('3/8')), 4);        // 1,5 × 0,95 = 1,43 < 4
    casiIgual(separacionMinima(buscarVarilla('1-3/8')), 5.37);      // 1,5 × 3,58 = 5,37 > 4
  });
});

describe('validar', () => {
  test('una entrada completa y coherente no produce errores', () => {
    assert.deepEqual(validar(ENTRADA_EJEMPLO), []);
  });

  test('detecta dimensiones faltantes según el tipo de columna', () => {
    const rect = validar({ ...ENTRADA_EJEMPLO, b: 0, h: undefined });
    assert.deepEqual(rect.map((e) => e.campo), ['b', 'h']);

    const circ = validar({ ...ENTRADA_EJEMPLO, tipo: 'circular', D: -10 });
    assert.deepEqual(circ.map((e) => e.campo), ['D']);
  });

  test('rechaza una cuantía fuera de 1 %–6 % (E.060 10.9.1)', () => {
    assert.deepEqual(validar({ ...ENTRADA_EJEMPLO, cuantia: 0.5 }).map((e) => e.campo), ['cuantia']);
    assert.deepEqual(validar({ ...ENTRADA_EJEMPLO, cuantia: 6.5 }).map((e) => e.campo), ['cuantia']);
    assert.deepEqual(validar({ ...ENTRADA_EJEMPLO, cuantia: 6 }), []); // el límite sí es válido
  });

  test("exige fy > 0,85·f'c, un método de cálculo y una varilla conocida", () => {
    assert.deepEqual(validar({ ...ENTRADA_EJEMPLO, fy: 150 }).map((e) => e.campo), ['fy']);
    assert.deepEqual(validar({ ...ENTRADA_EJEMPLO, metodo: 'otro' }).map((e) => e.campo), ['metodo']);
    assert.deepEqual(validar({ ...ENTRADA_EJEMPLO, varilla: '7/8' }).map((e) => e.campo), ['varilla']);
  });

  test('el método por carga exige una carga Pu positiva', () => {
    const errores = validar({ ...ENTRADA_EJEMPLO, metodo: 'carga', pu: 0 });
    assert.deepEqual(errores.map((e) => e.campo), ['pu']);
  });
});

describe('numeroBarras', () => {
  const rect = TIPOS.rectangular;
  const espiral = TIPOS.espiral;
  const v58 = buscarVarilla('5/8');

  test('redondea hacia arriba el cociente As / Abarra', () => {
    // 15 cm² / 2,00 cm² = 7,5 → 8 barras (par, no requiere ajuste de simetría)
    assert.deepEqual(numeroBarras(15, v58, rect), { n: 8, teorico: 8, motivo: 'calculo' });
  });

  test('aplica el mínimo normativo: 4 con estribos y 6 con espiral (E.060 10.9.2)', () => {
    assert.deepEqual(numeroBarras(1, v58, rect), { n: 4, teorico: 1, motivo: 'minimo' });
    assert.deepEqual(numeroBarras(1, v58, espiral), { n: 6, teorico: 1, motivo: 'minimo' });
  });

  test('en secciones rectangulares un resultado impar sube a par por simetría', () => {
    // 10 cm² / 2,00 cm² = 5 → 6 barras
    assert.deepEqual(numeroBarras(10, v58, rect), { n: 6, teorico: 5, motivo: 'simetria' });
  });

  test('en secciones circulares se conserva el número impar', () => {
    assert.deepEqual(numeroBarras(10, v58, TIPOS.circular), { n: 5, teorico: 5, motivo: 'calculo' });
  });
});

describe('distribuir', () => {
  test('rectangular 30 × 50 con 8 barras: 3 por cara, esquinas compartidas', () => {
    const seccion = { circular: false, b: 30, h: 50, ag: 1500 };
    const geo = distribuir(seccion, 8, buscarVarilla('5/8'), ESTRIBOS[0], 4);
    assert.equal(geo.circular, false);
    assert.deepEqual(geo.caras, { caraB: 3, caraH: 3 });
    assert.equal(geo.posiciones.length, 8);
    assert.equal(geo.separacion.minima, 4);
    assert.equal(geo.separacion.cumple, true);
  });

  test('circular: las barras quedan sobre el mismo radio y la cuerda define la separación', () => {
    const D = 40;
    const seccion = { circular: true, D, ag: (Math.PI * D ** 2) / 4 };
    const varilla = buscarVarilla('3/4');
    const geo = distribuir(seccion, 6, varilla, ESTRIBOS[0], 4);
    const margen = 4 + 0.95 + varilla.diametro / 2;
    casiIgual(geo.radioBarras, D / 2 - margen);
    for (const p of geo.posiciones) {
      casiIgual(Math.hypot(p.x - D / 2, p.y - D / 2), geo.radioBarras, 1e-9);
    }
    casiIgual(geo.separacion.libre, 2 * geo.radioBarras * Math.sin(Math.PI / 6) - varilla.diametro);
  });
});

describe('resistenciaAxial', () => {
  test('φPn,máx = α φ [0,85 f\'c (Ag − Ast) + fy Ast] en tonf (E.060 10.3.6)', () => {
    // 0,80 × 0,70 × [0,85 × 210 × (1500 − 16) + 4200 × 16] / 1000 = 185,97 tonf
    casiIgual(resistenciaAxial(TIPOS.rectangular, 1500, 16, 210, 4200), 185.97264, 1e-6);
  });

  test('a mayor área de acero, mayor resistencia', () => {
    const sinAcero = resistenciaAxial(TIPOS.espiral, 1256.64, 0, 280, 4200);
    const conAcero = resistenciaAxial(TIPOS.espiral, 1256.64, 17.04, 280, 4200);
    assert.ok(conAcero > sinAcero);
  });
});

describe('calcularColumna · ejemplo reproducible (docs/CALCULATIONS.md §7)', () => {
  const r = calcularColumna(ENTRADA_EJEMPLO);

  test('30 × 50 cm, ρ = 1 %, 5/8" → 8 varillas', () => {
    assert.equal(r.ok, true);
    assert.deepEqual(r.errores, []);
    assert.equal(r.seccion.ag, 1500);
    casiIgual(r.acero.asRequerido, 15);
    assert.equal(r.barras.n, 8);
    casiIgual(r.acero.asColocado, 16);
    casiIgual(r.acero.cuantiaColocada, 16 / 1500);
    assert.equal(r.acero.gobierna, 'cuantia');
  });

  test('selecciona estribo de 3/8" y distribuye 3 barras por cara', () => {
    assert.equal(r.estribo.id, '3/8');
    assert.deepEqual(r.geometria.caras, { caraB: 3, caraH: 3 });
    assert.equal(r.geometria.separacion.cumple, true);
  });

  test('no emite advertencias: cumple separación, dimensiones, recubrimiento y f\'c', () => {
    assert.deepEqual(r.advertencias, []);
  });

  test('propone una alternativa por cada diámetro y marca la actual', () => {
    assert.equal(r.alternativas.length, VARILLAS.length);
    const actuales = r.alternativas.filter((a) => a.actual);
    assert.equal(actuales.length, 1);
    assert.equal(actuales[0].varilla.id, '5/8');
    assert.equal(actuales[0].n, 8);
  });
});

describe('calcularColumna · otros casos', () => {
  test('25 × 25 cm, ρ = 1 %, 1/2" → 6 varillas por simetría', () => {
    const r = calcularColumna({ ...ENTRADA_EJEMPLO, b: 25, h: 25, varilla: '1/2' });
    assert.equal(r.ok, true);
    assert.equal(r.barras.teorico, 5); // 6,25 / 1,29 = 4,84 → 5
    assert.equal(r.barras.n, 6);
    assert.equal(r.barras.motivo, 'simetria');
  });

  test('circular con espiral D = 40 cm, ρ = 1 %, 3/4" → gobierna el mínimo de 6 barras', () => {
    const r = calcularColumna({ ...ENTRADA_EJEMPLO, tipo: 'espiral', D: 40, varilla: '3/4' });
    assert.equal(r.ok, true);
    casiIgual(r.seccion.ag, (Math.PI * 40 ** 2) / 4);
    assert.equal(r.barras.teorico, 5);
    assert.equal(r.barras.n, 6);
    assert.equal(r.barras.motivo, 'minimo');
    assert.equal(r.tipo.phi, 0.75);
  });

  test('método por carga: con Pu pequeña gobierna la cuantía mínima y la capacidad cumple', () => {
    const r = calcularColumna({ ...ENTRADA_EJEMPLO, metodo: 'carga', pu: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.acero.gobierna, 'minima');
    casiIgual(r.acero.asRequerido, 15);
    assert.equal(r.capacidad.pu, 100);
    assert.equal(r.capacidad.cumple, true);
    assert.ok(r.capacidad.phiPn >= 100);
  });

  test('método por carga: una Pu excesiva exige ρ > 6 % y la sección se declara insuficiente', () => {
    const r = calcularColumna({ ...ENTRADA_EJEMPLO, metodo: 'carga', pu: 600 });
    assert.equal(r.ok, false);
    assert.equal(r.errores.length, 1);
    assert.equal(r.errores[0].campo, 'pu');
    assert.match(r.errores[0].mensaje, /6 %/);
  });

  test('advierte cuando la dimensión menor, el recubrimiento o f\'c no cumplen el capítulo sísmico', () => {
    const r = calcularColumna({ ...ENTRADA_EJEMPLO, b: 20, h: 40, fc: 175, recubrimiento: 2.5, varilla: '1/2' });
    assert.equal(r.ok, true);
    const texto = r.advertencias.join('\n');
    assert.match(texto, /menor que 25 cm/);
    assert.match(texto, /mínimo de 4 cm/);
    assert.match(texto, /menor que 210 kg\/cm²/);
  });

  test('una entrada inválida devuelve ok = false con los errores de validar', () => {
    const r = calcularColumna({ ...ENTRADA_EJEMPLO, cuantia: 10 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errores.map((e) => e.campo), ['cuantia']);
    assert.deepEqual(r.advertencias, []);
  });
});
