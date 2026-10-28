# Contribuir

Gracias por mejorar Calculadora de Varillas. Es una aplicación académica de ingeniería estructural: un cambio pequeño en una fórmula puede alterar resultados de diseño, por lo que las modificaciones deben ser trazables, fáciles de revisar y **estar cubiertas por las pruebas automáticas** que ejecuta la integración continua.

## Preparación

Requisitos: Node.js 20 o posterior y un navegador moderno.

```bash
git clone https://github.com/ErickrU/ci-practica-equipo01.git
cd ci-practica-equipo01
npm start
```

Abre `http://localhost:8080/`. La aplicación no instala dependencias ni requiere credenciales para el desarrollo local.

## Flujo recomendado

1. Crea una rama desde `main` (`feature/...`, `fix/...` o `docs/...`).
2. Haz un cambio enfocado; evita mezclar fórmulas, interfaz y documentación sin necesidad.
3. Si cambias `js/calculo.js`, documenta la ecuación, unidades, hipótesis y referencia normativa, y agrega o ajusta la prueba correspondiente en `test/`.
4. Si cambias archivos incluidos en el app shell, incrementa `VERSION` en `sw.js` para que las instalaciones existentes reciban la actualización.
5. Ejecuta las verificaciones indicadas abajo.
6. Abre un pull request describiendo el problema, la solución y los casos comprobados. GitHub Actions volverá a ejecutar las pruebas sobre tu rama.

## Verificación mínima

```bash
npm run check   # sintaxis de los módulos y validez del manifest
npm test        # pruebas unitarias del motor de cálculo (node --test)
npm run build   # genera artefactos/ con la versión distribuible
```

Son exactamente los pasos que ejecuta el workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) en cada `push`; si fallan localmente, fallarán en GitHub. `artefactos/` y `artefacto.zip` están en `.gitignore`: el artefacto se descarga desde la pestaña Actions del run, no se versiona. Si agregas un archivo nuevo que la aplicación necesite en producción, inclúyelo en la allowlist de `herramientas/build.mjs` y en el precache de `sw.js`.

Después, prueba en el navegador:

- columna rectangular, circular y circular con espiral;
- método por cuantía y por carga axial;
- errores por dato vacío, cuantía fuera de 1 %–6 % y sección insuficiente;
- presentación en móvil y escritorio;
- recarga sin conexión después de una primera visita;
- actualización del service worker si cambiaste el app shell.

No publiques credenciales, identificadores de cuenta ni archivos `.env`.

## Estilo

- Código y documentación en español; nombres de APIs web pueden conservarse en inglés.
- JavaScript moderno, módulos ES y sin dependencias cuando la plataforma web sea suficiente.
- HTML semántico, navegación por teclado, mensajes asociados a sus controles y contraste WCAG AA.
- Usa términos inclusivos como `main`, `allowlist`, `denylist`, `primary` y `replica`.

## Cambios de cálculo

Un pull request que altere resultados debe incluir al menos:

- valores de entrada;
- desarrollo manual independiente;
- resultado anterior y nuevo;
- cláusula normativa aplicable;
- explicación de unidades y redondeos;
- la prueba unitaria que fija el nuevo resultado esperado.

La herramienta no reemplaza la revisión de un ingeniero estructural.
