# Seguridad

## Reportar una vulnerabilidad

No publiques detalles sensibles en un issue. Usa la opción **Report a vulnerability** de la pestaña Security del repositorio para enviar un reporte privado. Incluye impacto, pasos de reproducción y una prueba de concepto mínima que no afecte sistemas ajenos.

## Modelo de seguridad

La aplicación es estática y ejecuta todos los cálculos en el navegador:

- no tiene backend, base de datos, cuentas de usuario ni analítica;
- no transmite los valores del formulario;
- no usa dependencias JavaScript de terceros ni recursos de CDN;
- el service worker solo intercepta solicitudes `GET` del mismo origen;
- no se deben introducir secretos en HTML, JavaScript, el manifest ni Git;
- el servidor de desarrollo (`herramientas/servidor.mjs`) escucha únicamente en `127.0.0.1`.

La integración continua (GitHub Actions) solo ejecuta comprobaciones de sintaxis y pruebas unitarias; no despliega, no usa secretos y no requiere permisos adicionales sobre el repositorio.

## Alcance y datos

Los resultados son orientativos y académicos. Una discrepancia de ingeniería debe reportarse como defecto funcional con un cálculo manual reproducible; no es, por sí sola, una vulnerabilidad de seguridad.

Versiones con soporte: la rama `main`.
