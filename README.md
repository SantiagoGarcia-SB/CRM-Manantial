# CRM Manantial — Punto de Información

CRM interno construido sobre Google Apps Script (HTML Service + Google Sheets como base de datos). Sirve dos vistas: `asesor.html` (registro de transacciones en el punto de atención) y `coordinadora.html` (gestión y reportes), servidas por `Code.js` según el parámetro `?page=coord`.

## Estructura

- `Code.js` — punto de entrada (`doGet`), configuración, helpers de hojas.
- `Auth.js` — login (OTP por correo para asesores, PIN para coordinadoras) y gestión de asesores.
- `Personas.js`, `Actividades.js`, `Transacciones.js`, `Inscripciones.js`, `Legalizacion.js`, `Reportes.js`, `Email.js` — lógica de negocio por dominio.
- `asesor.html`, `coordinadora.html`, `styles.css.html`, `utils.js.html` — frontend. **Estos archivos en la raíz son los únicos que se despliegan.**

No hay carpetas de frontend alternativas: si en algún momento aparece una copia duplicada de estos HTML fuera de la raíz, no es la que ven los usuarios — bórrala o dile a alguien que lo haga, no la edites pensando que es la real.

## Desplegar

```
clasp push
```

Sube el contenido de la raíz al proyecto de Apps Script (`scriptId` en `.clasp.json`). `.claspignore` excluye `.git/`, `.claude/` y `node_modules/` del push.

No hay entorno de pruebas automatizado: antes de un `clasp push` a producción, probar manualmente el flujo de registro de pago en `asesor.html` y el dashboard en `coordinadora.html`.

## Configuración (Propiedades del proyecto)

El ID de la hoja de cálculo principal y los IDs/correo de las hojas de cierre **no están en el código** — viven en Propiedades del proyecto de Apps Script (Script Properties) y son editables sin volver a desplegar:

- Desde la app: pestaña **Ajustes** del panel de coordinadora.
- Desde el editor de Apps Script: `Configuración del proyecto → Propiedades del script`.

Claves usadas: `SPREADSHEET_ID`, `CIERRE_DATAFONO_SHEET_ID`, `CIERRE_GENERAL_SHEET_ID`, `CIERRE_GENERAL_EMAIL`. Si no se configuran, el sistema usa los valores por defecto embebidos en `Code.js` (`CONFIG_DEFAULTS_`).

## Primer despliegue en una hoja de cálculo nueva

Ejecutar una vez desde el editor de Apps Script (no expuestas al frontend):

1. `setupSheets()` — crea las hojas y encabezados faltantes.
2. `agregarColumnasFaltantes()` — agrega a hojas ya existentes cualquier columna que falte (útil después de una actualización del script que añade columnas nuevas, como `Modificado_Por`).

## Verificación rápida después de un despliegue

`diagnosticar()` (Code.js) recorre todas las hojas esperadas y reporta si existen y cuántas filas tienen — sirve como smoke test manual: correrla desde el editor de Apps Script después de un `clasp push` para confirmar que ninguna hoja quedó desconectada.
