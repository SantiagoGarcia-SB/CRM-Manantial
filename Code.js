// ─── CONFIGURACIÓN GLOBAL ────────────────────────────────────────────────────
// Los valores reales viven en Propiedades del proyecto (Script Properties), no en
// el código, para que la coordinadora pueda cambiarlos sin tocar el script (ver
// getConfiguracion/actualizarConfiguracion). Estos son solo los valores de
// arranque, usados la primera vez que corre el CRM antes de configurar nada.
const CONFIG_DEFAULTS_ = {
  SPREADSHEET_ID:             '1YTlDfnO-vfQp1L9zYIZDbc38nS9MJn0phIifIrV_O64',
  CIERRE_DATAFONO_SHEET_ID:   '1GnCSSsVp_bRcBGSbe6D9XpZN4-Z87iB-DNzi0be9dxY',
  CIERRE_GENERAL_SHEET_ID:    '17eM2YYQHXoMjV-dttSsGjEutL-llatbUo1rwfdRCuNU',
  CIERRE_GENERAL_EMAIL:       'elcamino.norte@manantial.co'
};

const CONFIG_LABELS_ = {
  SPREADSHEET_ID:           'Hoja de cálculo principal (ID)',
  CIERRE_DATAFONO_SHEET_ID: 'Hoja de cierre de datáfono (ID)',
  CIERRE_GENERAL_SHEET_ID:  'Hoja de cierre general (ID)',
  CIERRE_GENERAL_EMAIL:     'Correo que recibe el cierre gerencial'
};

/**
 * Lee un valor de configuración: primero Propiedades del proyecto, si no
 * existe cae al valor por defecto embebido en el código.
 */
function getConfig_(key) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  return val || CONFIG_DEFAULTS_[key];
}

/**
 * Configuración actual del sistema, para la pantalla de ajustes de la coordinadora.
 */
function getConfiguracion(token) {
  authenticate_(token);
  requireRol_('coordinadora');
  return Object.keys(CONFIG_DEFAULTS_).map(key => ({
    key:   key,
    label: CONFIG_LABELS_[key],
    valor: getConfig_(key)
  }));
}

/**
 * Actualiza uno o más valores de configuración en Propiedades del proyecto.
 * @param {Object} datos - { CLAVE: nuevoValor, ... }
 */
function actualizarConfiguracion(token, datos) {
  authenticate_(token);
  requireRol_('coordinadora');
  const props = PropertiesService.getScriptProperties();
  Object.keys(datos).forEach(key => {
    if (!CONFIG_DEFAULTS_.hasOwnProperty(key)) return;
    const val = String(datos[key] || '').trim();
    if (val) props.setProperty(key, val);
  });
  return { ok: true };
}

/**
 * Panel de salud del sistema para la coordinadora: estado de las hojas de datos,
 * conteos rápidos y estado del cierre consolidado del día — todo lo que antes
 * solo se podía ver corriendo funciones manualmente desde el editor de Apps
 * Script o revisando Stackdriver.
 */
function getSaludSistema(token) {
  authenticate_(token);
  requireRol_('coordinadora');

  const ss = getSpreadsheet();
  const hojas = Object.keys(SHEET_HEADERS).map(name => {
    const sheet = ss.getSheetByName(name);
    return { nombre: name, existe: !!sheet, filas: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0 };
  });

  const asesores    = sheetToObjects_('Asesores');
  const actividades = sheetToObjects_('Actividades');
  const activoTrue  = v => v === true || v === 'TRUE' || v === 'true';

  return {
    hojas: hojas,
    asesoresActivos:     asesores.filter(a => activoTrue(a.Activo)).length,
    asesoresTotal:       asesores.length,
    actividadesActivas:  actividades.filter(a => activoTrue(a.Activa)).length,
    actividadesTotal:    actividades.length,
    cierreHoy:           getEstadoCierreHoy(token)
  };
}

const SHEET_HEADERS = {
  Personas:       ['Documento','Nombre','Celular','Correo','Sede','Fecha_Registro'],
  Transacciones:  ['ID_Trans','Timestamp','Nombre_Persona','Documento_Persona','Celular_Persona','Actividad','Sede','Monto',
                   'Metodo_Pago','Asesor_Email','Asesor_Nombre',
                   'Estado_Legalizacion_Iglesia','Estado_Legalizacion_Academia',
                   'Datafono_Franquicia','Datafono_Tipo_Tarjeta','Datafono_Valor',
                   'Datafono_Titular_Mismo','Datafono_Nombre_Titular',
                   'Datafono_Doc_Titular','Datafono_Celular_Titular',
                   'Datafono_No_Autorizacion','Datafono_No_Datafono','Estado'],
  Inscripciones:  ['ID_Inscripcion','ID_Trans','Actividad','Modulo','Horario','Sede',
                   'Asesor_Email','Fecha',
                   'Nombre_Persona','Documento_Persona','Celular_Persona'],
  Actividades:    ['ID_Actividad','Nombre','Categoria','Valor_Base','Valor_Variable',
                   'Requiere_Inscripcion','Legalizar_Iglesia','Legalizar_Academia','Activa',
                   'Legalizar_Pago','Legalizar_Inscripcion','Horarios','Modulos',
                   'Modificado_Por','Modificado_Fecha'],
  Categorias:     ['ID_Categoria','Nombre'],
  Asesores:       ['Email','Nombre','Sede','Rol','Activo','Pin','Modificado_Por','Modificado_Fecha'],
  Legalizaciones: ['ID_Legal','ID_Trans','Tipo','Estado','Fecha_Legalizacion','Notas','Legalizado_Por']
};

// ─── PUNTO DE ENTRADA WEB ─────────────────────────────────────────────────────
// access: ANYONE_ANONYMOUS — autenticación propia vía código OTP por correo.
// ?page=coord → sirve coordinadora.html; por defecto → asesor.html
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) === 'coord' ? 'coordinadora' : 'asesor';
  return HtmlService.createTemplateFromFile(page).evaluate()
    .setTitle('Manantial · Punto de Información')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
}

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function cargarPaginaCoord() {
  return HtmlService.createTemplateFromFile('coordinadora').evaluate().getContent();
}

function getSpreadsheet() {
  const id = getConfig_('SPREADSHEET_ID');
  if (!id || id === 'TU_SPREADSHEET_ID_AQUI') {
    throw new Error('Configura SPREADSHEET_ID en Ajustes (o en Propiedades del proyecto) antes de usar el CRM.');
  }
  return SpreadsheetApp.openById(id);
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
      range.setBackground('#0d1829').setFontColor('#ffffff').setFontWeight('bold');
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

// ─── SETUP INICIAL DE HOJAS ───────────────────────────────────────────────────

function setupSheets() {
  const ss = getSpreadsheet();

  Object.entries(SHEET_HEADERS).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      const range = sheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setBackground('#0d1829').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
      Logger.log('Hoja creada: ' + name);
    } else {
      Logger.log('Hoja ya existe: ' + name);
    }
  });

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
    range.setBackground('#0d1829').setFontColor('#ffffff').setFontWeight('bold');
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
