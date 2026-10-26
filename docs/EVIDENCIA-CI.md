# Evidencia de la práctica de integración continua

**Equipo 01 – Help Desk 360** · Gestión del Proceso de Desarrollo de Software · IDyGS 101

| Entregable | Dónde está |
|---|---|
| URL del repositorio | <https://github.com/ErickrU/ci-practica-equipo01> |
| Workflow | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) · [Pestaña Actions](https://github.com/ErickrU/ci-practica-equipo01/actions/workflows/ci.yml) |
| Ejecución exitosa | [Run #1](https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415378588), [#2](https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415567852) y [#4](https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415770937) · logs en [`evidencia/`](evidencia/) |
| Ejecución fallida | [Run #3](https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415651422) · [`evidencia/run-03-fallido.log`](evidencia/run-03-fallido.log) |
| Conclusiones individuales | [Sección final de este documento](#conclusiones-individuales) |

Los archivos de [`docs/evidencia/`](evidencia/) son los logs descargados de GitHub Actions con `gh run view <id> --log` y el diff exacto del commit del error intencional. Las capturas de pantalla se toman de las URL indicadas en cada fase.

---

## Fase 1 · Repositorio

Repositorio `ci-practica-equipo01` creado en GitHub con README, licencia MIT, `.gitignore` y `.editorconfig`.

```text
ec21aa2  Add: README del repositorio ci-practica-equipo01
```

📸 Captura: <https://github.com/ErickrU/ci-practica-equipo01>

## Fase 2 · Proyecto funcional

En vez de la calculadora de ejemplo (`suma(a, b)`), se usó una aplicación existente del equipo: **Calculadora de Varillas**, una PWA en JavaScript sin dependencias que calcula el refuerzo longitudinal de columnas de concreto armado (NTP E.060). El equivalente a `calculadora.py` es [`js/calculo.js`](../js/calculo.js) (motor de cálculo sin DOM) y el equivalente a `test_calculadora.py` es [`test/calculo.test.mjs`](../test/calculo.test.mjs): **26 pruebas** con el test runner nativo de Node (`node:test`), que fijan, entre otros, el ejemplo reproducible `30 × 50 cm, ρ = 1 %, 5/8" → 8 varillas`.

```text
a20f826  Primer commit: Calculadora de Varillas con pruebas unitarias del motor de cálculo
```

Como el proyecto es JavaScript y no Python, el pipeline instala Node.js en lugar de Python y ejecuta `npm test` en lugar de `pytest`; la estructura del workflow es la misma que la de la práctica.

## Fase 3 · GitHub Actions

Archivo [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

```yaml
name: CI

on:
  push:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Instalar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Verificar sintaxis y manifest
        run: npm run check

      - name: Ejecutar pruebas
        run: npm test
```

```text
5e131da  Add: workflow de CI con GitHub Actions (pruebas en cada push)
```

📸 Captura: <https://github.com/ErickrU/ci-practica-equipo01/actions/workflows/ci.yml>

## Fase 4 · Verificación de la ejecución automática

Resumen de todas las ejecuciones (hora UTC, 26 de octubre de 2026):

| Run | Commit | Resultado | Inicio → fin | Duración total | Duración del job |
|---|---|---|---|---|---|
| [#1](https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415378588) | `5e131da` Add: workflow de CI | ✅ success | 22:49:35 → 22:49:48 | 13 s | 9 s |
| [#2](https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415567852) | `cfffe1c` Update: reporter spec | ✅ success | 22:51:07 → 22:51:21 | 14 s | 10 s |
| [#3](https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415651422) | `75b3a81` Error intencional | ❌ failure | 22:51:51 → 22:52:02 | 11 s | 7 s |
| [#4](https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415770937) | `b63a6ae` Fix: restaurar la fórmula | ✅ success | 22:52:51 → 22:53:01 | 10 s | 8 s |

### ¿Se ejecutó automáticamente?

**Sí.** Ningún integrante entró a GitHub a lanzar nada: el evento `push` del commit `5e131da` disparó el run #1 en el mismo segundo en que el push terminó (`event: push`, 22:49:35 UTC). Cada uno de los pushes posteriores produjo su propia ejecución sin intervención manual.

### ¿Cuánto tardó?

Entre **10 y 14 segundos** de principio a fin en cada ejecución; el job `test` en sí tardó entre 7 y 10 segundos. Las 26 pruebas se ejecutan en menos de 0,2 s (`duration_ms 118–182`); el resto del tiempo es aprovisionar el runner `ubuntu-latest`, clonar el repositorio y preparar Node.js (que se tomó de la caché del runner, por eso tardó 1 s).

### ¿Qué tareas realizó?

Pasos del job `test` en el run #1 (de [`evidencia/run-01-exitoso.log`](evidencia/run-01-exitoso.log)):

| # | Paso | Qué hizo | Resultado |
|---|---|---|---|
| 1 | Set up job | Asigna una máquina virtual `ubuntu-latest` y descarga las actions usadas | ✅ |
| 2 | `actions/checkout@v4` | Clona el repositorio en el commit que disparó el evento | ✅ |
| 3 | Instalar Node.js (`actions/setup-node@v4`) | Instala Node.js **v22.23.3** y npm 10.9.9 | ✅ |
| 4 | Verificar sintaxis y manifest (`npm run check`) | `node --check` de los módulos JS y validación JSON del `manifest.webmanifest` | ✅ |
| 5 | Ejecutar pruebas (`npm test`) | `node --test`: **26 pruebas, 26 pasan, 0 fallan** | ✅ |
| 9–11 | Post steps / Complete job | Limpieza de credenciales de checkout y de procesos | ✅ |

📸 Capturas: <https://github.com/ErickrU/ci-practica-equipo01/actions> (lista de ejecuciones) y <https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415378588> (detalle del run exitoso con los pasos).

## Fase 5 · Fallo intencional

El equivalente a cambiar `return a+b` por `return a-b` fue invertir el signo del aporte del acero en la fórmula de resistencia axial (`js/calculo.js`, función `resistenciaAxial`, E.060 10.3.6). Diff completo en [`evidencia/error-intencional.diff`](evidencia/error-intencional.diff):

```diff
 export function resistenciaAxial(tipo, ag, ast, fc, fy) {
-  return (tipo.alfa * tipo.phi * (0.85 * fc * (ag - ast) + fy * ast)) / 1000;
+  return (tipo.alfa * tipo.phi * (0.85 * fc * (ag - ast) - fy * ast)) / 1000;
 }
```

```text
75b3a81  Error intencional: restar en lugar de sumar el aporte del acero en resistenciaAxial
```

### Lo que observó el pipeline (run #3, ❌ failure)

Los pasos 1 a 4 pasaron (la sintaxis era válida: el error era *lógico*, no de escritura). El paso 5 **Ejecutar pruebas** falló con código de salida 1 y marcó el commit en rojo. Extracto de [`evidencia/run-03-fallido.log`](evidencia/run-03-fallido.log):

```text
ℹ tests 26
ℹ pass 24
ℹ fail 2

✖ failing tests:

✖ φPn,máx = α φ [0,85 f'c (Ag − Ast) + fy Ast] en tonf (E.060 10.3.6)
  AssertionError [ERR_ASSERTION]: 110.70863999999999 ≠ 185.97264 (±0.000001)
      at casiIgual (test/calculo.test.mjs:44:10)

✖ a mayor área de acero, mayor resistencia
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
    assert.ok(conAcero > sinAcero)

##[error]Process completed with exit code 1.
```

La prueba señaló exactamente el daño: para la columna del ejemplo, la capacidad calculada bajó de **185,97 tonf a 110,71 tonf** (un 40 % menos), y además el programa pasó a afirmar que agregar acero *reduce* la resistencia de la columna. En la interfaz la aplicación habría seguido funcionando sin ningún mensaje de error: solo mostraría un número equivocado.

📸 Capturas: <https://github.com/ErickrU/ci-practica-equipo01/actions/runs/40415651422> (run fallido) y el paso «Ejecutar pruebas» expandido.

### Corrección

```text
b63a6ae  Fix: restaurar la suma del aporte del acero en resistenciaAxial (E.060 10.3.6)
```

El run #4 volvió a verde con 26/26 pruebas ([`evidencia/run-04-exitoso-tras-fix.log`](evidencia/run-04-exitoso-tras-fix.log)).

### Reflexión: ¿qué ventaja tiene detectar el error antes de liberar el software?

1. **El error se detecta en segundos, no cuando lo sufre un usuario.** Once segundos después del push el equipo ya sabía que el commit `75b3a81` estaba roto, qué prueba falló, en qué línea y con qué valores. Sin CI, el error habría quedado en `main` hasta que alguien notara, en obra o en una revisión, que la resistencia reportada no cuadraba con el cálculo manual.
2. **El costo de corregir es mínimo.** El diff tenía una sola línea cambiada, así que la causa era obvia. Cuanto más tarde se descubre un defecto, más commits se acumulan encima y más caro es aislarlo y revertirlo.
3. **Protege contra errores silenciosos.** Este defecto no rompía la sintaxis ni lanzaba excepciones: `npm run check` pasó. Solo una prueba que compara contra un valor conocido podía detectarlo. En una aplicación de ingeniería estructural, un número equivocado que "se ve bien" es el peor tipo de error.
4. **`main` se mantiene liberable.** Cualquier integrante puede confiar en que lo que está en verde funciona, y el equipo puede aplicar la regla de no integrar un pull request con el pipeline en rojo.
5. **Documenta la calidad de forma objetiva.** El historial de Actions es evidencia verificable de que cada versión fue probada, sin depender de que alguien recuerde haber corrido las pruebas en su máquina.

---

## Conclusiones individuales

### Erick Alexander Rangel Urbina · DevOps Engineer

Configurar el pipeline me dejó claro que la integración continua no es una herramienta más, sino una forma de trabajar: un workflow de poco más de 20 líneas convierte cada `git push` en una verificación completa del proyecto en una máquina limpia, igual para todos los integrantes. Lo más valioso fue ver el run #3 en rojo once segundos después del push y con el mensaje exacto (`110.71 ≠ 185.97`), porque demuestra que la retroalimentación inmediata es lo que permite integrar cambios pequeños y frecuentes sin miedo. También aprendí que el pipeline vale lo que valen sus pruebas: `npm run check` no detectó nada porque el código era sintácticamente válido; fue la prueba unitaria con un valor de referencia la que atrapó el defecto. Mi siguiente paso sería proteger la rama `main` para exigir que el workflow esté en verde antes de hacer merge.

### Jose Eduardo Caballero Urrutia · QA / Test Automation Engineer

Desde la perspectiva de calidad, la práctica confirma que las pruebas automatizadas solo generan valor cuando se ejecutan siempre, no cuando alguien se acuerda de correrlas. Al mover las 26 pruebas del motor de cálculo a GitHub Actions, dejaron de ser un paso opcional y se convirtieron en una compuerta: el commit `75b3a81` no pudo pasar en silencio. Me pareció importante que las pruebas se diseñaran a partir de la documentación y de la norma (el ejemplo `30 × 50 cm → 8 varillas`, la fórmula de E.060 10.3.6), porque así una falla no dice solo "algo cambió", sino "el resultado ya no coincide con el valor que la norma exige". El reto que veo hacia adelante es ampliar la cobertura a la interfaz y al comportamiento offline de la PWA, que hoy se verifican a mano.

### Leydi Jaret Gallegos Badillo · Scrum Master / Product Owner

Para la gestión del proyecto, la integración continua reduce la incertidumbre: en cualquier momento puedo abrir la pestaña Actions y saber si lo que hay en `main` funciona, sin preguntarle a nadie. Eso cambia la conversación del equipo, porque un pull request en rojo se discute con datos (qué prueba, qué valor) y no con opiniones, y el tiempo que antes se iba en revisar manualmente cálculos se invierte en revisar diseño y criterio. El fallo intencional dejó una lección de negocio concreta: detectar el error costó segundos y una línea de código; detectarlo después de liberar habría costado credibilidad frente a quien usa la herramienta para decidir cuántas varillas colocar en una columna. La definición de "terminado" del equipo debería incluir, a partir de ahora, el pipeline en verde.
