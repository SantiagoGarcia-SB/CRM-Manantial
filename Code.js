// ─── CONFIGURACIÓN GLOBAL ────────────────────────────────────────────────────
// Reemplaza con el ID de tu Google Spreadsheet
const SPREADSHEET_ID = '14MIW7gNQTiuVv_GelNN9iPCvalAx8VA0urQ14VuswEM';

// Cabeceras de cada hoja
const SHEET_HEADERS = {
  Personas:       ['ID_Persona','Nombre','Documento','Celular','Correo','Sede','Fecha_Registro'],
  Transacciones:  ['ID_Trans','Timestamp','ID_Persona','Nombre_Persona','Actividad','Sede','Monto',
                   'Metodo_Pago','Asesor_Email','Asesor_Nombre',
                   'Estado_Legalizacion_Iglesia','Estado_Legalizacion_Academia','Periodo',
                   'Datafono_Franquicia','Datafono_Tipo_Tarjeta','Datafono_Valor',
                   'Datafono_Beneficiario_Mismo','Datafono_Nombre_Beneficiario',
                   'Datafono_Doc_Beneficiario','Datafono_Celular_Beneficiario',
                   'Datafono_No_Autorizacion','Datafono_No_Datafono'],
  Inscripciones:  ['ID_Inscripcion','ID_Trans','ID_Persona','Actividad','Modulo','Horario','Sede',
                   'Periodo','Asesor_Email','Fecha'],
  Actividades:    ['ID_Actividad','Nombre','Categoria','Valor_Base','Valor_Variable',
                   'Requiere_Inscripcion','Legalizar_Iglesia','Legalizar_Academia','Activa'],
  Periodos:       ['ID_Periodo','Nombre','Tipo','Año','Fecha_Inicio','Fecha_Fin','Activo'],
  Asesores:       ['Email','Nombre','Sede','Rol','Activo'],
  Legalizaciones: ['ID_Legal','ID_Trans','Tipo','Estado','Fecha_Legalizacion','Notas']
};

// ─── PUNTO DE ENTRADA WEB ─────────────────────────────────────────────────────
function doGet(e) {
  const email = Session.getActiveUser().getEmail();
  const roleInfo = getRole_(email);

  if (!roleInfo) {
    return buildErrorPage_('Tu cuenta no está registrada en el sistema. Contacta a tu coordinadora.');
  }
  if (!roleInfo.activo) {
    return buildErrorPage_('Tu cuenta está desactivada. Contacta a tu coordinadora.');
  }

  let tmpl;
  if (roleInfo.rol === 'coordinadora') {
    tmpl = HtmlService.createTemplateFromFile('coordinadora');
  } else {
    tmpl = HtmlService.createTemplateFromFile('asesor');
  }

  tmpl.userEmail = email;
  tmpl.userName  = roleInfo.nombre;
  tmpl.userSede  = roleInfo.sede;
  tmpl.userRol   = roleInfo.rol;

  return tmpl.evaluate()
    .setTitle('CRM Manantial')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
}

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────

/** Incluye contenido de otro archivo HTML (para CSS/JS partials). */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Retorna el Spreadsheet activo. Lanza error si SPREADSHEET_ID no está configurado. */
function getSpreadsheet() {
  if (SPREADSHEET_ID === 'TU_SPREADSHEET_ID_AQUI') {
    throw new Error('Configura SPREADSHEET_ID en Code.gs antes de usar el CRM.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Obtiene una hoja por nombre. Si no existe y createIfMissing=true, la crea con headers.
 * @param {string} name - Nombre de la hoja
 * @param {boolean} createIfMissing
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet_(name, createIfMissing = false) {
  const ss    = getSpreadsheet();
  let   sheet = ss.getSheetByName(name);
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet(name);
    const headers = SHEET_HEADERS[name];
    if (headers) {
      const range = sheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setBackground('#1a1f36').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/**
 * Convierte los datos de una hoja en array de objetos usando la primera fila como keys.
 * @param {string} sheetName
 * @returns {Object[]}
 */
function sheetToObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

/**
 * Genera un ID único basado en timestamp + random.
 * @param {string} prefix - Ej: 'PER', 'TRN'
 * @returns {string}
 */
function generateId_(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

/** Página de error HTML simple. */
function buildErrorPage_(mensaje) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Acceso Restringido – CRM Manantial</title>
  <style>
    body{margin:0;font-family:'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;
         display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .card{background:#181c27;border:1px solid #2d3148;border-radius:12px;
          padding:40px;max-width:400px;text-align:center;}
    h2{color:#ef4444;margin-bottom:12px;}
    p{color:#94a3b8;line-height:1.6;}
    .icon{font-size:48px;margin-bottom:16px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h2>Acceso No Autorizado</h2>
    <p>${mensaje}</p>
  </div>
</body>
</html>`;
  return HtmlService.createHtmlOutput(html)
    .setTitle('Acceso Restringido')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── SETUP INICIAL DE HOJAS ───────────────────────────────────────────────────

/**
 * Ejecutar UNA VEZ desde el editor para crear todas las hojas con sus cabeceras.
 * También inserta datos de muestra en Asesores y Actividades.
 */
function setupSheets() {
  const ss = getSpreadsheet();

  Object.entries(SHEET_HEADERS).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      const range = sheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setBackground('#1a1f36').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
      Logger.log('Hoja creada: ' + name);
    } else {
      Logger.log('Hoja ya existe: ' + name);
    }
  });

  // Insertar periodo activo de ejemplo si Periodos está vacía
  const periodos = ss.getSheetByName('Periodos');
  if (periodos.getLastRow() < 2) {
    const now = new Date();
    periodos.appendRow([
      generateId_('PER'),
      'Semestre 1 - 2025',
      'Semestre1',
      2025,
      new Date(now.getFullYear(), 0, 1),
      new Date(now.getFullYear(), 5, 30),
      true
    ]);
    Logger.log('Periodo de ejemplo insertado');
  }

  // Insertar actividades de ejemplo si están vacías
  const actividades = ss.getSheetByName('Actividades');
  if (actividades.getLastRow() < 2) {
    const actividadesEjemplo = [
      [generateId_('ACT'), 'Diezmo',            'Ofrenda',    0,       true,  false, true,  false, true],
      [generateId_('ACT'), 'Ofrenda General',   'Ofrenda',    0,       true,  false, true,  false, true],
      [generateId_('ACT'), 'Escuela Dominical',  'Academia',   50000,   false, true,  true,  true,  true],
      [generateId_('ACT'), 'Preuniversitario',   'Academia',   120000,  false, true,  true,  true,  true],
      [generateId_('ACT'), 'Alabanza',           'Ministerio', 0,       false, true,  false, false, true]
    ];
    actividades.getRange(2, 1, actividadesEjemplo.length, actividadesEjemplo[0].length)
      .setValues(actividadesEjemplo);
    Logger.log('Actividades de ejemplo insertadas');
  }

  return { ok: true, mensaje: 'Hojas configuradas correctamente. Revisa el Logger para detalles.' };
}

// ─── MIGRACIÓN DE COLUMNAS ────────────────────────────────────────────────────

/**
 * Agrega las columnas faltantes a hojas existentes según SHEET_HEADERS.
 * Ejecutar UNA VEZ desde el editor de Apps Script cuando se agreguen columnas nuevas.
 */
function agregarColumnasFaltantes() {
  const ss = getSpreadsheet();
  Object.entries(SHEET_HEADERS).forEach(([name, headers]) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const faltantes = headers.filter(h => !actualHeaders.includes(h));
    if (!faltantes.length) { Logger.log(name + ': sin columnas faltantes'); return; }
    const colInicio = actualHeaders.length + 1;
    const range = sheet.getRange(1, colInicio, 1, faltantes.length);
    range.setValues([faltantes]);
    range.setBackground('#1a1f36').setFontColor('#ffffff').setFontWeight('bold');
    Logger.log(name + ': columnas agregadas → ' + faltantes.join(', '));
  });
  return { ok: true };
}

// ─── FUNCIÓN DE DIAGNÓSTICO ───────────────────────────────────────────────────

/** Verifica que todas las hojas existen y tienen datos. Útil para debugging. */
function diagnosticar() {
  const ss = getSpreadsheet();
  const resultado = {};
  Object.keys(SHEET_HEADERS).forEach(name => {
    const sheet = ss.getSheetByName(name);
    resultado[name] = sheet
      ? { existe: true, filas: Math.max(0, sheet.getLastRow() - 1) }
      : { existe: false, filas: 0 };
  });
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}
