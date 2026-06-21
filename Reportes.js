// ─── REPORTES.GS ──────────────────────────────────────────────────────────────
// Contrato público:
//   getKPIsDashboard()                    → Object
//   getRecaudoPorActividad(sede?)         → Object[]
//   getDistribucionPorSede(sede?)         → Object[]
//   getDistribucionPorMetodo(sede?)       → Object[]
//   getActividadReciente(limite?, sede?)  → Object[]
//   getDesempenoAsesores(sede?)           → Object[]
//   getAlertasDashboard()                 → Object

function getKPIsDashboard(token, _, sede) {
  authenticate_(token);
  requireRol_('coordinadora');

  const transacciones  = sheetToObjects_('Transacciones');
  const inscripciones  = sheetToObjects_('Inscripciones');
  const legalizaciones = sheetToObjects_('Legalizaciones');

  const ahora     = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

  const sedeMap = sede ? buildAsesorSedeMap_() : null;

  let transFiltradas = transacciones.filter(t => (t.Estado || 'Activa') !== 'Anulada');
  if (sede) transFiltradas = transFiltradas.filter(t => sedeMap[t.Asesor_Email] === sede);

  const recaudoTotal = transFiltradas.reduce((s, t) => s + (Number(t.Monto) || 0), 0);

  let inscFiltradas = inscripciones;
  if (sede) inscFiltradas = inscFiltradas.filter(i => sedeMap[i.Asesor_Email] === sede);

  const pagosPendientes = legalizaciones.filter(l => l.Estado === 'Pendiente').length;

  let sinLegal = transFiltradas.filter(t =>
    t.Estado_Legalizacion_Iglesia === 'Pendiente' ||
    t.Estado_Legalizacion_Academia === 'Pendiente'
  );
  if (sede) sinLegal = sinLegal.filter(t => sedeMap[t.Asesor_Email] === sede);

  let transHoy = transFiltradas.filter(t => t.Timestamp && new Date(t.Timestamp) >= inicioHoy);
  if (sede) transHoy = transHoy.filter(t => sedeMap[t.Asesor_Email] === sede);

  return {
    recaudoTotal,
    inscripcionesActivas: inscFiltradas.length,
    pagosPendientes,
    sinLegalizar:     sinLegal.length,
    transaccionesHoy: transHoy.length
  };
}

function getRecaudoPorActividad(token, _, sede) {
  authenticate_(token);
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones').filter(t => (t.Estado || 'Activa') !== 'Anulada');
  if (sede) {
    const sedeMap = buildAsesorSedeMap_();
    trans = trans.filter(t => sedeMap[t.Asesor_Email] === sede);
  }

  const agrupado = {};
  trans.forEach(t => {
    const key = t.Actividad || 'Sin actividad';
    if (!agrupado[key]) agrupado[key] = { actividad: key, cantidad: 0, recaudado: 0 };
    agrupado[key].cantidad++;
    agrupado[key].recaudado += Number(t.Monto) || 0;
  });

  return Object.values(agrupado).sort((a, b) => b.recaudado - a.recaudado);
}

function getDistribucionPorSede(token, _, sede) {
  authenticate_(token);
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones').filter(t => (t.Estado || 'Activa') !== 'Anulada');
  if (sede) {
    const sedeMap = buildAsesorSedeMap_();
    trans = trans.filter(t => sedeMap[t.Asesor_Email] === sede);
  }

  const agrupado = {};
  trans.forEach(t => {
    const key = t.Sede || 'Sin sede';
    if (!agrupado[key]) agrupado[key] = { sede: key, recaudado: 0, cantidad: 0 };
    agrupado[key].recaudado += Number(t.Monto) || 0;
    agrupado[key].cantidad++;
  });

  return Object.values(agrupado);
}

function getDistribucionPorMetodo(token, _, sede) {
  authenticate_(token);
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones').filter(t => (t.Estado || 'Activa') !== 'Anulada');
  if (sede) {
    const sedeMap = buildAsesorSedeMap_();
    trans = trans.filter(t => sedeMap[t.Asesor_Email] === sede);
  }

  const agrupado = {};
  trans.forEach(t => {
    const key = t.Metodo_Pago || 'Desconocido';
    if (!agrupado[key]) agrupado[key] = { metodo: key, recaudado: 0, cantidad: 0 };
    agrupado[key].recaudado += Number(t.Monto) || 0;
    agrupado[key].cantidad++;
  });

  return Object.values(agrupado);
}

function getActividadReciente(token, limite, _, sede) {
  authenticate_(token);
  requireRol_('coordinadora');
  limite = limite || 15;
  let trans = sheetToObjects_('Transacciones').filter(t => (t.Estado || 'Activa') !== 'Anulada');
  if (sede) {
    const sedeMap = buildAsesorSedeMap_();
    trans = trans.filter(t => sedeMap[t.Asesor_Email] === sede);
  }
  return trans
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .slice(0, limite)
    .map(t => ({
      idTrans:       t.ID_Trans,
      nombrePersona: t.Nombre_Persona,
      actividad:     t.Actividad,
      monto:         Number(t.Monto) || 0,
      metodoPago:    t.Metodo_Pago,
      asesorNombre:  t.Asesor_Nombre,
      sede:          t.Sede,
      fecha:         t.Timestamp ? formatDate_(new Date(t.Timestamp)) : ''
    }));
}

function getDesempenoAsesores(token, _, sede) {
  authenticate_(token);
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones').filter(t => (t.Estado || 'Activa') !== 'Anulada');
  if (sede) {
    const sedeMap = buildAsesorSedeMap_();
    trans = trans.filter(t => sedeMap[t.Asesor_Email] === sede);
  }

  const porAsesor = {};
  trans.forEach(t => {
    const email = t.Asesor_Email || 'desconocido';
    if (!porAsesor[email]) {
      porAsesor[email] = {
        email,
        nombre:          t.Asesor_Nombre || email,
        transacciones:   0,
        recaudado:       0,
        ultimaActividad: null
      };
    }
    porAsesor[email].transacciones++;
    porAsesor[email].recaudado += Number(t.Monto) || 0;
    const ts = t.Timestamp ? new Date(t.Timestamp) : null;
    if (ts && (!porAsesor[email].ultimaActividad || ts > porAsesor[email].ultimaActividad)) {
      porAsesor[email].ultimaActividad = ts;
    }
  });

  const asesoresMap = {};
  sheetToObjects_('Asesores').forEach(a => { asesoresMap[a.Email] = a; });

  return Object.values(porAsesor)
    .map(a => ({
      ...a,
      sede:            (asesoresMap[a.email] || {}).Sede || '',
      ultimaActividad: a.ultimaActividad ? formatDate_(a.ultimaActividad) : 'Nunca'
    }))
    .sort((a, b) => b.recaudado - a.recaudado);
}

function getAlertasDashboard(token) {
  authenticate_(token);
  requireRol_('coordinadora');
  const sinLegalizar7Dias   = getAlertasPendientes_(7);
  const resumenLeg          = getResumenLegalizacion_();

  const ahora     = new Date();
  const hace3dias = new Date(ahora);
  hace3dias.setDate(ahora.getDate() - 3);

  const trans     = sheetToObjects_('Transacciones').filter(t => (t.Estado || 'Activa') !== 'Anulada');
  const asesores  = sheetToObjects_('Asesores').filter(a => toBool_(a.Activo) && a.Rol === 'asesor');

  const ultimaTransPorAsesor = {};
  trans.forEach(t => {
    const email = t.Asesor_Email;
    const ts    = t.Timestamp ? new Date(t.Timestamp) : null;
    if (email && ts && (!ultimaTransPorAsesor[email] || ts > ultimaTransPorAsesor[email])) {
      ultimaTransPorAsesor[email] = ts;
    }
  });

  const asesoresSinActividad = asesores
    .filter(a => {
      const ultima = ultimaTransPorAsesor[a.Email];
      return !ultima || ultima < hace3dias;
    })
    .map(a => ({
      email:           a.Email,
      nombre:          a.Nombre,
      sede:            a.Sede,
      ultimaActividad: ultimaTransPorAsesor[a.Email]
        ? formatDate_(ultimaTransPorAsesor[a.Email])
        : 'Nunca'
    }));

  return { sinLegalizar7Dias, asesoresSinActividad, resumenLeg };
}

function buildAsesorSedeMap_() {
  const map = {};
  sheetToObjects_('Asesores').forEach(a => { map[a.Email] = a.Sede; });
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIERRE DIARIO DATÁFONO — Trigger automático
// ═══════════════════════════════════════════════════════════════════════════════
const CIERRE_DATAFONO_SHEET_ID = '1GnCSSsVp_bRcBGSbe6D9XpZN4-Z87iB-DNzi0be9dxY';

/**
 * Ejecutar con trigger diario (23:00–23:59 zona America/Bogota).
 * Si hay transacciones de Datáfono del día, crea una pestaña DD-MM-YYYY
 * con resumen consolidado + bloques por sede + subtotales + gran total.
 */
function cierreDatafonoDiario() {
  const ahora    = new Date();
  const tz       = 'America/Bogota';
  const hoy      = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const finDia   = new Date(hoy);
  finDia.setHours(23, 59, 59, 999);

  const trans = sheetToObjects_('Transacciones')
    .filter(t => t.Metodo_Pago === 'Datáfono' && (t.Estado || 'Activa') !== 'Anulada' && t.Timestamp && new Date(t.Timestamp) >= hoy && new Date(t.Timestamp) <= finDia);

  if (!trans.length) {
    Logger.log('Cierre datáfono: sin transacciones hoy, no se crea pestaña.');
    return;
  }

  trans.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

  const nombrePestana = Utilities.formatDate(ahora, tz, 'dd-MM-yyyy');
  const fechaGen      = Utilities.formatDate(ahora, tz, 'dd/MM/yyyy HH:mm');
  const ss            = SpreadsheetApp.openById(CIERRE_DATAFONO_SHEET_ID);

  let sheet = ss.getSheetByName(nombrePestana);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(nombrePestana, 0);
  }

  // Agrupar por sede
  const porSede = {};
  trans.forEach(t => {
    const s = t.Sede || 'Sin sede';
    if (!porSede[s]) porSede[s] = [];
    porSede[s].push(t);
  });
  const sedes = Object.keys(porSede).sort();

  const headers = [
    'FECHA DATÁFONO','FRANQUICIA','N° AUTORIZACIÓN','VALOR',
    'NOMBRE TITULAR','CÉDULA','CELULAR',
    'BENEFICIARIO DE PAGO','CÉDULA DE BENEFICIARIO','CELULAR DE BENEFICIARIO',
    'CONCEPTO','DÉBITO/CRÉDITO','N° DATÁFONO'
  ];
  const totalCols = headers.length;
  const fmtCOP = v => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v||0);

  function mapRow_(t) {
    return [
      t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
      t.Datafono_Franquicia           || '',
      t.Datafono_No_Autorizacion      || '',
      Number(t.Datafono_Valor)        || 0,
      t.Nombre_Persona                || '',
      t.Documento_Persona             || '',
      t.Celular_Persona               || '',
      t.Datafono_Nombre_Beneficiario  || '',
      t.Datafono_Doc_Beneficiario     || '',
      t.Datafono_Celular_Beneficiario || '',
      t.Actividad                     || '',
      t.Datafono_Tipo_Tarjeta         || '',
      t.Datafono_No_Datafono          || ''
    ];
  }

  const rows = [];
  const formats = [];
  const merges = [];
  const boldRows = [];
  const headerRows = [];
  const sedeHeaderRows = [];
  const subtotalRows = [];

  // ── TÍTULO ──
  rows.push(['CIERRE DATÁFONO', ...Array(totalCols - 1).fill('')]);
  boldRows.push(rows.length);
  merges.push(rows.length);
  rows.push([`Generado: ${fechaGen}`, ...Array(totalCols - 1).fill('')]);
  merges.push(rows.length);
  rows.push(Array(totalCols).fill(''));

  // ── RESUMEN CONSOLIDADO ──
  rows.push(['SEDE', 'N° TRANSACCIONES', 'TOTAL DATÁFONO', ...Array(totalCols - 3).fill('')]);
  headerRows.push(rows.length);

  let granTotal = 0;
  sedes.forEach(sede => {
    const items = porSede[sede];
    const totalSede = items.reduce((s, t) => s + (Number(t.Datafono_Valor) || 0), 0);
    granTotal += totalSede;
    rows.push([sede, items.length, totalSede, ...Array(totalCols - 3).fill('')]);
  });

  rows.push(['GRAN TOTAL', trans.length, granTotal, ...Array(totalCols - 3).fill('')]);
  boldRows.push(rows.length);
  subtotalRows.push(rows.length);

  // ── BLOQUES POR SEDE ──
  sedes.forEach(sede => {
    const items = porSede[sede];
    const totalSede = items.reduce((s, t) => s + (Number(t.Datafono_Valor) || 0), 0);

    rows.push(Array(totalCols).fill(''));
    rows.push(Array(totalCols).fill(''));

    rows.push([`📍 ${sede} — ${items.length} transacción(es)`, ...Array(totalCols - 1).fill('')]);
    sedeHeaderRows.push(rows.length);
    merges.push(rows.length);

    rows.push(headers);
    headerRows.push(rows.length);

    items.forEach(t => rows.push(mapRow_(t)));

    const subtotalLabel = Array(totalCols).fill('');
    subtotalLabel[0] = `SUBTOTAL ${sede}`;
    subtotalLabel[3] = totalSede;
    rows.push(subtotalLabel);
    boldRows.push(rows.length);
    subtotalRows.push(rows.length);
  });

  // ── GRAN TOTAL FINAL ──
  rows.push(Array(totalCols).fill(''));
  const gtRow = Array(totalCols).fill('');
  gtRow[0] = 'GRAN TOTAL DATÁFONO';
  gtRow[3] = granTotal;
  rows.push(gtRow);
  boldRows.push(rows.length);
  subtotalRows.push(rows.length);

  // ── ESCRIBIR DATOS ──
  sheet.getRange(1, 1, rows.length, totalCols).setValues(rows);

  // ── FORMATO: Título ──
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold').setFontColor('#6c63ff');
  sheet.getRange(2, 1).setFontSize(9).setFontColor('#888888');

  // ── FORMATO: Merges (título, fecha, encabezados sede) ──
  merges.forEach(r => {
    sheet.getRange(r, 1, 1, totalCols).merge();
  });

  // ── FORMATO: Headers de tabla (resumen + cada sede) ──
  headerRows.forEach(r => {
    const range = sheet.getRange(r, 1, 1, totalCols);
    range.setBackground('#2d3148').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  });

  // ── FORMATO: Encabezados de sede ──
  sedeHeaderRows.forEach(r => {
    const range = sheet.getRange(r, 1, 1, totalCols);
    range.setBackground('#6c63ff').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  });

  // ── FORMATO: Filas de subtotal/gran total ──
  subtotalRows.forEach(r => {
    const range = sheet.getRange(r, 1, 1, totalCols);
    range.setFontWeight('bold').setBackground('#f0f0f0').setBorder(true, true, true, true, false, false);
  });

  // ── FORMATO: Columna VALOR (D) como moneda ──
  sheet.getRange(1, 4, rows.length, 1).setNumberFormat('$ #,##0');

  // ── FORMATO: Auto-ajustar columnas ──
  for (let c = 1; c <= totalCols; c++) {
    sheet.autoResizeColumn(c);
  }

  Logger.log(`Cierre datáfono ${nombrePestana}: ${trans.length} transacciones en ${sedes.length} sede(s). Gran total: ${granTotal}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIERRE DIARIO GENERAL — Todas las transacciones + correo
// ═══════════════════════════════════════════════════════════════════════════════
const CIERRE_GENERAL_SHEET_ID = '17eM2YYQHXoMjV-dttSsGjEutL-llatbUo1rwfdRCuNU';
const CIERRE_GENERAL_EMAIL    = 'elcamino.norte@manantial.co';

/**
 * Ejecutar con trigger diario (23:00–23:59 zona America/Bogota).
 * Si hay transacciones del día (cualquier método), crea pestaña DD-MM-YYYY
 * con resumen desglosado por sede/método + bloques por sede + envía correo.
 */
function cierreGeneralDiario() {
  const ahora  = new Date();
  const tz     = 'America/Bogota';
  const hoy    = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const finDia = new Date(hoy);
  finDia.setHours(23, 59, 59, 999);

  const trans = sheetToObjects_('Transacciones')
    .filter(t => (t.Estado || 'Activa') !== 'Anulada' && t.Timestamp && new Date(t.Timestamp) >= hoy && new Date(t.Timestamp) <= finDia);

  if (!trans.length) {
    Logger.log('Cierre general: sin transacciones hoy, no se crea pestaña.');
    return;
  }

  trans.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

  const nombrePestana = Utilities.formatDate(ahora, tz, 'dd-MM-yyyy');
  const fechaGen      = Utilities.formatDate(ahora, tz, 'dd/MM/yyyy HH:mm');
  const ss            = SpreadsheetApp.openById(CIERRE_GENERAL_SHEET_ID);

  let sheet = ss.getSheetByName(nombrePestana);
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet(nombrePestana, 0);

  // Agrupar por sede
  const porSede = {};
  trans.forEach(t => {
    const s = t.Sede || 'Sin sede';
    if (!porSede[s]) porSede[s] = [];
    porSede[s].push(t);
  });
  const sedes = Object.keys(porSede).sort();
  const metodos = ['Efectivo', 'Datáfono', 'Nequi'];

  const headers = [
    'FECHA','PERSONA','CÉDULA','CELULAR','ACTIVIDAD','MONTO','MÉTODO DE PAGO','SEDE','ASESOR',
    'FRANQUICIA','N° AUTORIZACIÓN','VALOR DATÁFONO',
    'BENEFICIARIO DE PAGO','CÉDULA BENEFICIARIO','CELULAR BENEFICIARIO',
    'DÉBITO/CRÉDITO','N° DATÁFONO'
  ];
  const totalCols = headers.length;
  const colMonto = 5; // índice 0-based de MONTO

  function mapRow_(t) {
    return [
      t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
      t.Nombre_Persona                || '',
      t.Documento_Persona             || '',
      t.Celular_Persona               || '',
      t.Actividad                     || '',
      Number(t.Monto)                 || 0,
      t.Metodo_Pago                   || '',
      t.Sede                          || '',
      t.Asesor_Nombre                 || '',
      t.Datafono_Franquicia           || '',
      t.Datafono_No_Autorizacion      || '',
      Number(t.Datafono_Valor)        || 0,
      t.Datafono_Nombre_Beneficiario  || '',
      t.Datafono_Doc_Beneficiario     || '',
      t.Datafono_Celular_Beneficiario || '',
      t.Datafono_Tipo_Tarjeta         || '',
      t.Datafono_No_Datafono          || ''
    ];
  }

  // Calcular totales para resumen y correo
  function calcTotalesSede_(items) {
    const t = { efectivo: 0, datafono: 0, nequi: 0, total: 0, count: items.length };
    items.forEach(tr => {
      const m = Number(tr.Monto) || 0;
      t.total += m;
      if (tr.Metodo_Pago === 'Efectivo')  t.efectivo += m;
      if (tr.Metodo_Pago === 'Datáfono')  t.datafono += m;
      if (tr.Metodo_Pago === 'Nequi')     t.nequi    += m;
    });
    return t;
  }

  const totalesPorSede = {};
  sedes.forEach(s => { totalesPorSede[s] = calcTotalesSede_(porSede[s]); });

  const rows = [];
  const merges = [];
  const headerRows = [];
  const sedeHeaderRows = [];
  const subtotalRows = [];

  // ── TÍTULO ──
  rows.push(['CIERRE DIARIO DE TRANSACCIONES', ...Array(totalCols - 1).fill('')]);
  merges.push(rows.length);
  rows.push(['Generado: ' + fechaGen, ...Array(totalCols - 1).fill('')]);
  merges.push(rows.length);
  rows.push(Array(totalCols).fill(''));

  // ── RESUMEN CONSOLIDADO POR SEDE Y MÉTODO ──
  const resHeaders = ['SEDE', 'N° TRANS.', 'EFECTIVO', 'DATÁFONO', 'NEQUI', 'TOTAL', ...Array(totalCols - 6).fill('')];
  rows.push(resHeaders);
  headerRows.push(rows.length);

  let gtEfectivo = 0, gtDatafono = 0, gtNequi = 0, gtTotal = 0, gtCount = 0;
  sedes.forEach(sede => {
    const t = totalesPorSede[sede];
    gtEfectivo += t.efectivo; gtDatafono += t.datafono; gtNequi += t.nequi; gtTotal += t.total; gtCount += t.count;
    rows.push([sede, t.count, t.efectivo, t.datafono, t.nequi, t.total, ...Array(totalCols - 6).fill('')]);
  });

  rows.push(['GRAN TOTAL', gtCount, gtEfectivo, gtDatafono, gtNequi, gtTotal, ...Array(totalCols - 6).fill('')]);
  subtotalRows.push(rows.length);

  // ── BLOQUES POR SEDE ──
  sedes.forEach(sede => {
    const items = porSede[sede];
    const t = totalesPorSede[sede];

    rows.push(Array(totalCols).fill(''));
    rows.push(Array(totalCols).fill(''));

    rows.push(['📍 ' + sede + ' — ' + items.length + ' transacción(es)', ...Array(totalCols - 1).fill('')]);
    sedeHeaderRows.push(rows.length);
    merges.push(rows.length);

    rows.push(headers);
    headerRows.push(rows.length);

    items.forEach(tr => rows.push(mapRow_(tr)));

    const sub = Array(totalCols).fill('');
    sub[0] = 'SUBTOTAL ' + sede;
    sub[colMonto] = t.total;
    rows.push(sub);
    subtotalRows.push(rows.length);
  });

  // ── GRAN TOTAL FINAL ──
  rows.push(Array(totalCols).fill(''));
  const gtRow = Array(totalCols).fill('');
  gtRow[0] = 'GRAN TOTAL';
  gtRow[colMonto] = gtTotal;
  rows.push(gtRow);
  subtotalRows.push(rows.length);

  // ── ESCRIBIR ──
  sheet.getRange(1, 1, rows.length, totalCols).setValues(rows);

  // ── FORMATO ──
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold').setFontColor('#6c63ff');
  sheet.getRange(2, 1).setFontSize(9).setFontColor('#888888');

  merges.forEach(r => sheet.getRange(r, 1, 1, totalCols).merge());

  headerRows.forEach(r => {
    sheet.getRange(r, 1, 1, totalCols).setBackground('#2d3148').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  });

  sedeHeaderRows.forEach(r => {
    sheet.getRange(r, 1, 1, totalCols).setBackground('#6c63ff').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  });

  subtotalRows.forEach(r => {
    sheet.getRange(r, 1, 1, totalCols).setFontWeight('bold').setBackground('#f0f0f0').setBorder(true, true, true, true, false, false);
  });

  // Formato moneda: columnas MONTO(F), EFECTIVO(C), DATÁFONO(D), NEQUI(E), TOTAL(F) en resumen + MONTO en detalle + VALOR DATÁFONO(L)
  sheet.getRange(1, 3, rows.length, 4).setNumberFormat('$ #,##0');
  sheet.getRange(1, colMonto + 1, rows.length, 1).setNumberFormat('$ #,##0');
  sheet.getRange(1, 12, rows.length, 1).setNumberFormat('$ #,##0');

  for (let c = 1; c <= totalCols; c++) sheet.autoResizeColumn(c);

  // ── ENVIAR CORREO ──
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/' + CIERRE_GENERAL_SHEET_ID + '/edit#gid=' + sheet.getSheetId();
  const fmtM = v => '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v || 0);

  let sedesHtml = '';
  sedes.forEach(sede => {
    const t = totalesPorSede[sede];
    sedesHtml += '<tr>'
      + '<td style="padding:8px 14px;font-weight:600;border-bottom:1px solid #e2e8f0">' + sede + '</td>'
      + '<td style="padding:8px 14px;text-align:center;border-bottom:1px solid #e2e8f0">' + t.count + '</td>'
      + '<td style="padding:8px 14px;text-align:right;border-bottom:1px solid #e2e8f0">' + fmtM(t.efectivo) + '</td>'
      + '<td style="padding:8px 14px;text-align:right;border-bottom:1px solid #e2e8f0">' + fmtM(t.datafono) + '</td>'
      + '<td style="padding:8px 14px;text-align:right;border-bottom:1px solid #e2e8f0">' + fmtM(t.nequi) + '</td>'
      + '<td style="padding:8px 14px;text-align:right;font-weight:700;border-bottom:1px solid #e2e8f0">' + fmtM(t.total) + '</td>'
      + '</tr>';
  });

  const emailHtml = '<!DOCTYPE html><html><body style="font-family:\'Segoe UI\',Arial,sans-serif;background:#f8fafc;padding:20px">'
    + '<div style="max-width:650px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">'
    + '<div style="background:#1a1d2e;padding:24px 30px">'
    + '<h1 style="color:#6c63ff;margin:0;font-size:20px">⛪ Cierre Diario de Transacciones</h1>'
    + '<p style="color:#94a3b8;margin:6px 0 0;font-size:13px">' + nombrePestana + ' · Generado: ' + fechaGen + '</p>'
    + '</div>'
    + '<div style="padding:24px 30px">'
    + '<h2 style="font-size:15px;color:#1a1d2e;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.05em">Resumen por sede</h2>'
    + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<thead><tr style="background:#f1f5f9">'
    + '<th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b">Sede</th>'
    + '<th style="padding:10px 14px;text-align:center;font-size:11px;text-transform:uppercase;color:#64748b">Trans.</th>'
    + '<th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b">Efectivo</th>'
    + '<th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b">Datáfono</th>'
    + '<th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b">Nequi</th>'
    + '<th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b">Total</th>'
    + '</tr></thead><tbody>' + sedesHtml + '</tbody>'
    + '<tfoot><tr style="background:#1a1d2e">'
    + '<td style="padding:10px 14px;font-weight:700;color:#fff">GRAN TOTAL</td>'
    + '<td style="padding:10px 14px;text-align:center;font-weight:700;color:#fff">' + gtCount + '</td>'
    + '<td style="padding:10px 14px;text-align:right;font-weight:700;color:#10b981">' + fmtM(gtEfectivo) + '</td>'
    + '<td style="padding:10px 14px;text-align:right;font-weight:700;color:#6c63ff">' + fmtM(gtDatafono) + '</td>'
    + '<td style="padding:10px 14px;text-align:right;font-weight:700;color:#3b82f6">' + fmtM(gtNequi) + '</td>'
    + '<td style="padding:10px 14px;text-align:right;font-weight:700;color:#f59e0b;font-size:15px">' + fmtM(gtTotal) + '</td>'
    + '</tr></tfoot></table>'
    + '<div style="margin-top:24px;text-align:center">'
    + '<a href="' + sheetUrl + '" style="display:inline-block;background:#6c63ff;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Ver reporte completo →</a>'
    + '</div></div>'
    + '<div style="background:#f8fafc;padding:16px 30px;text-align:center;font-size:11px;color:#94a3b8">'
    + 'CRM Punto de Información · Manantial · Reporte automático'
    + '</div></div></body></html>';

  MailApp.sendEmail({
    to:       CIERRE_GENERAL_EMAIL,
    subject:  'Cierre Diario ' + nombrePestana + ' — ' + fmtM(gtTotal),
    htmlBody: emailHtml
  });

  Logger.log('Cierre general ' + nombrePestana + ': ' + trans.length + ' trans, ' + sedes.length + ' sede(s). Total: ' + gtTotal + '. Correo enviado.');
}

/**
 * Instala los triggers diarios para ambos cierres.
 * Ejecutar UNA vez manualmente desde el editor de Apps Script.
 */
function instalarTriggersCierre() {
  const funciones = ['cierreDatafonoDiario', 'cierreGeneralDiario'];

  funciones.forEach(fn => {
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === fn)
      .forEach(t => ScriptApp.deleteTrigger(t));

    ScriptApp.newTrigger(fn)
      .timeBased()
      .atHour(23)
      .everyDays(1)
      .inTimezone('America/Bogota')
      .create();

    Logger.log('Trigger instalado: ' + fn + ' a las 23:00 cada día (America/Bogota)');
  });
}
