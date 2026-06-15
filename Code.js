// ─── CONFIGURACIÓN GLOBAL ────────────────────────────────────────────────────
const SPREADSHEET_ID = '1YTlDfnO-vfQp1L9zYIZDbc38nS9MJn0phIifIrV_O64';

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
// access: ANYONE_ANONYMOUS — autenticación propia vía código OTP por correo.
// ?page=coord → sirve coordinadora.html; por defecto → asesor.html
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) === 'coord' ? 'coordinadora' : 'asesor';
  return HtmlService.createTemplateFromFile(page).evaluate()
    .setTitle('CRM Manantial')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
}

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSpreadsheet() {
  if (SPREADSHEET_ID === 'TU_SPREADSHEET_ID_AQUI') {
    throw new Error('Configura SPREADSHEET_ID en Code.gs antes de usar el CRM.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

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

function generateId_(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// ─── PÁGINA DE CUENTA NO AUTORIZADA ──────────────────────────────────────────

/**
 * Se muestra cuando el usuario autenticado no está registrado en el sistema.
 * Con ANYONE_WITH_GOOGLE_LINK, el email siempre está disponible, así que
 * los botones ?authuser=N funcionan correctamente para cambiar de cuenta.
 */
function buildErrorPage_(mensaje, emailDetectado) {
  const appUrl = ScriptApp.getService().getUrl();

  const emailBadge = emailDetectado
    ? '<div class="email-badge">Cuenta activa: <strong>' + emailDetectado + '</strong></div>'
    : '';

  const cuentaBtns = [0,1,2,3].map(function(n) {
    var url = appUrl + '?authuser=' + n;
    var esActual = (n === 0 && !!emailDetectado);
    var cls = esActual ? 'btn-cuenta btn-actual' : 'btn-cuenta';
    var texto = esActual ? '1ª cuenta (actual — no registrada)' : (n + 1) + 'ª cuenta';
    return '<a href="' + url + '" class="' + cls + '">' + texto + '</a>';
  }).join('');

  const css = [
    '*{box-sizing:border-box}',
    'body{margin:0;font-family:Segoe UI,sans-serif;background:#0f1117;color:#e2e8f0;',
    'display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}',
    '.card{background:#181c27;border:1px solid #2d3148;border-radius:12px;',
    'padding:28px 20px;max-width:400px;width:100%;text-align:center}',
    'h2{color:#ef4444;margin:0 0 10px;font-size:1.05rem}',
    'p{color:#94a3b8;font-size:14px;margin:0 0 14px;line-height:1.5}',
    '.icon{font-size:40px;margin-bottom:14px}',
    '.email-badge{background:#1e2340;border:1px solid #3b4169;border-radius:6px;',
    'padding:7px 12px;font-size:13px;color:#94a3b8;word-break:break-all;',
    'display:inline-block;margin-bottom:16px}',
    '.email-badge strong{color:#c7d2fe}',
    'hr{border:none;border-top:1px solid #2d3148;margin:16px 0}',
    '.hint{font-size:12px;color:#64748b;margin-bottom:10px}',
    '.btn-cuenta{display:block;width:100%;padding:12px;margin-bottom:9px;',
    'background:#1e2340;border:1px solid #3b4169;border-radius:8px;',
    'color:#c7d2fe;text-decoration:none;font-size:14px;font-weight:600;transition:background .15s}',
    '.btn-cuenta:hover{background:#252b4a;border-color:#6c63ff}',
    '.btn-actual{background:#111827;border-color:#374151;color:#475569;',
    'font-size:13px;font-weight:400;pointer-events:none;cursor:default}',
    '.nota{font-size:11px;color:#475569;margin-top:14px;line-height:1.5}'
  ].join('');

  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="es"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Acceso Restringido – CRM Manantial</title>' +
    '<style>' + css + '</style></head><body>' +
    '<div class="card">' +
    '<div class="icon">🔒</div>' +
    '<h2>Cuenta no autorizada</h2>' +
    '<p>' + mensaje + '</p>' +
    emailBadge +
    '<hr>' +
    '<p class="hint">Selecciona otra cuenta de Google:</p>' +
    cuentaBtns +
    '<div class="nota">Si tu correo no aparece, ábrelo en Gmail primero y vuelve a intentar.</div>' +
    '</div></body></html>'
  )
    .setTitle('Acceso Restringido')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── SETUP INICIAL DE HOJAS ───────────────────────────────────────────────────

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

  const periodos = ss.getSheetByName('Periodos');
  if (periodos.getLastRow() < 2) {
    const now = new Date();
    periodos.appendRow([
      generateId_('PER'), 'Semestre 1 - 2025', 'Semestre1', 2025,
      new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 5, 30), true
    ]);
  }

  const actividades = ss.getSheetByName('Actividades');
  if (actividades.getLastRow() < 2) {
    const ej = [
      [generateId_('ACT'), 'Diezmo',           'Ofrenda',    0,      true,  false, true,  false, true],
      [generateId_('ACT'), 'Ofrenda General',  'Ofrenda',    0,      true,  false, true,  false, true],
      [generateId_('ACT'), 'Escuela Dominical', 'Academia',  50000,  false, true,  true,  true,  true],
      [generateId_('ACT'), 'Preuniversitario',  'Academia',  120000, false, true,  true,  true,  true],
      [generateId_('ACT'), 'Alabanza',          'Ministerio',0,      false, true,  false, false, true]
    ];
    actividades.getRange(2, 1, ej.length, ej[0].length).setValues(ej);
  }

  return { ok: true, mensaje: 'Hojas configuradas correctamente.' };
}

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
