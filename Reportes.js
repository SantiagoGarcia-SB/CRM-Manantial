// ─── REPORTES.GS ──────────────────────────────────────────────────────────────
// Contrato público:
//   getKPIsDashboard()                    → Object
//   getRecaudoPorActividad(sede?)         → Object[]
//   getDistribucionPorSede(sede?)         → Object[]
//   getDistribucionPorMetodo(sede?)       → Object[]
//   getActividadReciente(limite?, sede?)  → Object[]
//   getDesempenoAsesores(sede?)           → Object[]
//   getAlertasDashboard()                 → Object

function resolverTitularBeneficiario_(t) {
  var esDiferente = t.Datafono_Titular_Mismo === 'No';
  if (!esDiferente) {
    return {
      titular: t.Nombre_Persona || '', titularDoc: t.Documento_Persona || '', titularCel: t.Celular_Persona || '',
      benef: '', benefDoc: '', benefCel: ''
    };
  }
  return {
    titular: t.Datafono_Nombre_Titular || '', titularDoc: t.Datafono_Doc_Titular || '', titularCel: t.Datafono_Celular_Titular || '',
    benef: t.Nombre_Persona || '', benefDoc: t.Documento_Persona || '', benefCel: t.Celular_Persona || ''
  };
}

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
// EMAIL GERENCIAL DE CIERRE — HTML ejecutivo para gerencia
// ═══════════════════════════════════════════════════════════════════════════════

function buildEmailCierreGerencial_(opts) {
  var trans = opts.trans;
  var anuladas = opts.anuladas || [];
  var inscripciones = opts.inscripciones || [];
  var fmtM = function(v) { return '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v || 0); };
  var pct = function(p, t) { return t ? ((p / t) * 100).toFixed(1) + '%' : '0%'; };
  var fmtHora = function(d) { return Utilities.formatDate(d, 'America/Bogota', 'h:mm a'); };

  var totalRecaudo = 0;
  trans.forEach(function(t) { totalRecaudo += Number(t.Monto) || 0; });
  var ticketProm = trans.length ? Math.round(totalRecaudo / trans.length) : 0;

  var timestamps = [];
  trans.forEach(function(t) { if (t.Timestamp) timestamps.push(new Date(t.Timestamp)); });
  timestamps.sort(function(a, b) { return a - b; });
  var primeraHora = timestamps.length ? fmtHora(timestamps[0]) : '—';
  var ultimaHora = timestamps.length ? fmtHora(timestamps[timestamps.length - 1]) : '—';

  var porSede = {};
  trans.forEach(function(t) {
    var s = t.Sede || 'Sin sede';
    if (!porSede[s]) porSede[s] = { efectivo: 0, datafono: 0, nequi: 0, total: 0, count: 0 };
    var m = Number(t.Monto) || 0;
    porSede[s].total += m; porSede[s].count++;
    if (t.Metodo_Pago === 'Efectivo') porSede[s].efectivo += m;
    else if (t.Metodo_Pago === 'Datáfono') porSede[s].datafono += m;
    else if (t.Metodo_Pago === 'Nequi') porSede[s].nequi += m;
  });
  var sedes = Object.keys(porSede).sort();

  var porMetodo = {};
  ['Efectivo','Datáfono','Nequi'].forEach(function(mp) { porMetodo[mp] = { total: 0, count: 0 }; });
  trans.forEach(function(t) {
    var mp = t.Metodo_Pago || 'Otro';
    if (!porMetodo[mp]) porMetodo[mp] = { total: 0, count: 0 };
    porMetodo[mp].total += Number(t.Monto) || 0;
    porMetodo[mp].count++;
  });

  var porActividad = {};
  trans.forEach(function(t) {
    var a = t.Actividad || 'Sin actividad';
    if (!porActividad[a]) porActividad[a] = { total: 0, count: 0 };
    porActividad[a].total += Number(t.Monto) || 0;
    porActividad[a].count++;
  });
  var actividadesOrd = Object.keys(porActividad).sort(function(a, b) { return porActividad[b].total - porActividad[a].total; });

  var porAsesor = {};
  trans.forEach(function(t) {
    var key = t.Asesor_Email || 'desconocido';
    if (!porAsesor[key]) porAsesor[key] = { nombre: t.Asesor_Nombre || key, sede: t.Sede || '', total: 0, count: 0 };
    porAsesor[key].total += Number(t.Monto) || 0;
    porAsesor[key].count++;
  });
  var asesoresOrd = Object.keys(porAsesor).sort(function(a, b) { return porAsesor[b].total - porAsesor[a].total; });

  var pendIglesia = 0, pendAcademia = 0;
  trans.forEach(function(t) {
    if (t.Estado_Legalizacion_Iglesia === 'Pendiente') pendIglesia++;
    if (t.Estado_Legalizacion_Academia === 'Pendiente') pendAcademia++;
  });

  var totalAnulado = 0;
  anuladas.forEach(function(t) { totalAnulado += Number(t.Monto) || 0; });

  var inscPorAct = {};
  inscripciones.forEach(function(i) {
    var a = i.Actividad || 'Sin actividad';
    if (!inscPorAct[a]) inscPorAct[a] = 0;
    inscPorAct[a]++;
  });
  var actInscOrd = Object.keys(inscPorAct).sort(function(a, b) { return inscPorAct[b] - inscPorAct[a]; });

  // ── Estilos reutilizables (compactos para email) ──
  var S = {
    th:   'padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b;background:#f1f5f9',
    thR:  'padding:6px 10px;text-align:right;font-size:10px;text-transform:uppercase;color:#64748b;background:#f1f5f9',
    thC:  'padding:6px 10px;text-align:center;font-size:10px;text-transform:uppercase;color:#64748b;background:#f1f5f9',
    td:   'padding:5px 10px;border-bottom:1px solid #e2e8f0;font-size:12px',
    tdR:  'padding:5px 10px;text-align:right;border-bottom:1px solid #e2e8f0;font-size:12px',
    tdC:  'padding:5px 10px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:12px',
    tdB:  'padding:5px 10px;font-weight:600;border-bottom:1px solid #e2e8f0;font-size:12px',
    ftTd: 'padding:6px 10px;font-weight:700;color:#fff;font-size:12px',
    ftR:  'padding:6px 10px;text-align:right;font-weight:700;color:#fff;font-size:12px',
    ftC:  'padding:6px 10px;text-align:center;font-weight:700;color:#fff;font-size:12px',
    sec:  'font-size:13px;color:#0d1829;margin:20px 0 8px;text-transform:uppercase;letter-spacing:0.05em',
    tbl:  'width:100%;border-collapse:collapse'
  };

  var h = '';

  // ── Contenedor ──
  h += '<!DOCTYPE html><html><body style="font-family:\'Segoe UI\',Arial,sans-serif;background:#f8fafc;padding:12px">';
  h += '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">';

  // ── Header ──
  h += '<div style="background:#0d1829;padding:18px 20px">';
  h += '<img src="https://www.soymanantial.com/footer/50.svg" alt="Manantial" style="height:26px;margin-bottom:10px">';
  h += '<h1 style="color:#667eea;margin:0;font-size:16px">' + opts.titulo + '</h1>';
  h += '<p style="color:#94a3b8;margin:4px 0 0;font-size:11px">' + opts.fecha + ' · Generado: ' + opts.fechaGen + '</p>';
  h += '</div>';

  h += '<div style="padding:16px 20px">';

  // ══ PANEL EJECUTIVO ══
  h += '<table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin-bottom:16px"><tr>';

  h += '<td style="background:#f0fdf4;border-radius:6px;padding:10px 6px;text-align:center;width:25%">';
  h += '<div style="font-size:14px;font-weight:700;color:#16a34a">' + fmtM(totalRecaudo) + '</div>';
  h += '<div style="font-size:9px;color:#64748b;text-transform:uppercase;margin-top:2px">Recaudado</div></td>';

  h += '<td style="background:#eff6ff;border-radius:6px;padding:10px 6px;text-align:center;width:25%">';
  h += '<div style="font-size:14px;font-weight:700;color:#2563eb">' + trans.length + '</div>';
  h += '<div style="font-size:9px;color:#64748b;text-transform:uppercase;margin-top:2px">Trans.</div></td>';

  h += '<td style="background:#faf5ff;border-radius:6px;padding:10px 6px;text-align:center;width:25%">';
  h += '<div style="font-size:14px;font-weight:700;color:#7c3aed">' + fmtM(ticketProm) + '</div>';
  h += '<div style="font-size:9px;color:#64748b;text-transform:uppercase;margin-top:2px">Ticket Prom.</div></td>';

  h += '<td style="background:#fefce8;border-radius:6px;padding:10px 6px;text-align:center;width:25%">';
  h += '<div style="font-size:11px;font-weight:600;color:#ca8a04">' + primeraHora + ' → ' + ultimaHora + '</div>';
  h += '<div style="font-size:9px;color:#64748b;text-transform:uppercase;margin-top:2px">Horario</div></td>';

  h += '</tr></table>';

  // ══ RECAUDO POR SEDE ══
  if (opts.mostrarSedes && sedes.length > 0) {
    h += '<h2 style="' + S.sec + '">📍 Recaudo por Sede</h2>';
    h += '<table style="' + S.tbl + '"><thead><tr>';
    h += '<th style="' + S.th + '">Sede</th><th style="' + S.thC + '">Trans.</th>';
    h += '<th style="' + S.thR + '">Total</th><th style="' + S.thR + '">%</th>';
    h += '</tr></thead><tbody>';

    sedes.forEach(function(sede) {
      var d = porSede[sede];
      h += '<tr><td style="' + S.tdB + '">' + sede + '</td>';
      h += '<td style="' + S.tdC + '">' + d.count + '</td>';
      h += '<td style="' + S.tdR + ';font-weight:700">' + fmtM(d.total) + '</td>';
      h += '<td style="' + S.tdR + '">' + pct(d.total, totalRecaudo) + '</td></tr>';
    });

    h += '</tbody><tfoot><tr style="background:#0d1829">';
    h += '<td style="' + S.ftTd + '">TOTAL</td><td style="' + S.ftC + '">' + trans.length + '</td>';
    h += '<td style="' + S.ftR + ';color:#f59e0b">' + fmtM(totalRecaudo) + '</td>';
    h += '<td style="' + S.ftR + '">100%</td>';
    h += '</tr></tfoot></table>';
  }

  // ══ DISTRIBUCIÓN POR MÉTODO DE PAGO ══
  var metodoColores = { 'Efectivo': '#10b981', 'Datáfono': '#667eea', 'Nequi': '#3b82f6' };
  h += '<h2 style="' + S.sec + '">💰 Distribución por Método de Pago</h2>';
  h += '<table style="' + S.tbl + '"><thead><tr>';
  h += '<th style="' + S.th + '">Método</th><th style="' + S.thC + '">Trans.</th>';
  h += '<th style="' + S.thR + '">Total</th><th style="' + S.thR + '">% del Total</th>';
  h += '</tr></thead><tbody>';

  Object.keys(porMetodo).forEach(function(mp) {
    var d = porMetodo[mp];
    if (d.count === 0) return;
    h += '<tr><td style="' + S.td + ';font-weight:600;color:' + (metodoColores[mp] || '#64748b') + '">' + mp + '</td>';
    h += '<td style="' + S.tdC + '">' + d.count + '</td>';
    h += '<td style="' + S.tdR + '">' + fmtM(d.total) + '</td>';
    h += '<td style="' + S.tdR + '">' + pct(d.total, totalRecaudo) + '</td></tr>';
  });

  h += '</tbody><tfoot><tr style="background:#0d1829">';
  h += '<td style="' + S.ftTd + '">TOTAL</td><td style="' + S.ftC + '">' + trans.length + '</td>';
  h += '<td style="' + S.ftR + ';color:#f59e0b">' + fmtM(totalRecaudo) + '</td>';
  h += '<td style="' + S.ftR + '">100%</td>';
  h += '</tr></tfoot></table>';

  // ══ RECAUDO POR ACTIVIDAD ══
  h += '<h2 style="' + S.sec + '">📋 Recaudo por Actividad</h2>';
  h += '<table style="' + S.tbl + '"><thead><tr>';
  h += '<th style="' + S.th + '">Actividad</th><th style="' + S.thC + '">Trans.</th>';
  h += '<th style="' + S.thR + '">Total</th><th style="' + S.thR + '">%</th>';
  h += '</tr></thead><tbody>';

  actividadesOrd.forEach(function(act) {
    var d = porActividad[act];
    h += '<tr><td style="' + S.tdB + '">' + act + '</td>';
    h += '<td style="' + S.tdC + '">' + d.count + '</td>';
    h += '<td style="' + S.tdR + '">' + fmtM(d.total) + '</td>';
    h += '<td style="' + S.tdR + '">' + pct(d.total, totalRecaudo) + '</td></tr>';
  });
  h += '</tbody></table>';

  // ══ RENDIMIENTO DE ASESORES ══
  h += '<h2 style="' + S.sec + '">👥 Asesores</h2>';
  h += '<table style="' + S.tbl + '"><thead><tr>';
  h += '<th style="' + S.th + '">Asesor</th>';
  h += '<th style="' + S.thC + '">Trans.</th><th style="' + S.thR + '">Total</th><th style="' + S.thR + '">%</th>';
  h += '</tr></thead><tbody>';

  asesoresOrd.forEach(function(key) {
    var d = porAsesor[key];
    h += '<tr><td style="' + S.tdB + '">' + d.nombre + '</td>';
    h += '<td style="' + S.tdC + '">' + d.count + '</td>';
    h += '<td style="' + S.tdR + '">' + fmtM(d.total) + '</td>';
    h += '<td style="' + S.tdR + '">' + pct(d.total, totalRecaudo) + '</td></tr>';
  });
  h += '</tbody></table>';

  // ══ TRANSACCIONES ANULADAS ══
  if (anuladas.length > 0) {
    h += '<h2 style="' + S.sec + ';color:#ef4444">❌ Transacciones Anuladas</h2>';
    h += '<table style="' + S.tbl + '"><thead><tr>';
    h += '<th style="' + S.th + '">Persona</th><th style="' + S.th + '">Actividad</th>';
    h += '<th style="' + S.thR + '">Monto</th><th style="' + S.th + '">Asesor</th>';
    h += '</tr></thead><tbody>';

    anuladas.forEach(function(t) {
      h += '<tr><td style="' + S.td + '">' + (t.Nombre_Persona || '') + '</td>';
      h += '<td style="' + S.td + '">' + (t.Actividad || '') + '</td>';
      h += '<td style="' + S.tdR + ';color:#ef4444">' + fmtM(Number(t.Monto) || 0) + '</td>';
      h += '<td style="' + S.td + '">' + (t.Asesor_Nombre || '') + '</td></tr>';
    });

    h += '</tbody><tfoot><tr style="background:#fef2f2">';
    h += '<td colspan="2" style="padding:10px 14px;font-weight:700;color:#ef4444">' + anuladas.length + ' anulada(s)</td>';
    h += '<td style="padding:10px 14px;text-align:right;font-weight:700;color:#ef4444">' + fmtM(totalAnulado) + '</td>';
    h += '<td style="padding:10px 14px"></td>';
    h += '</tr></tfoot></table>';
  }

  // ══ INSCRIPCIONES DEL TURNO ══
  if (actInscOrd.length > 0) {
    h += '<h2 style="' + S.sec + '">📝 Inscripciones del Turno</h2>';
    h += '<table style="' + S.tbl + '"><thead><tr>';
    h += '<th style="' + S.th + '">Actividad</th><th style="' + S.thC + '">Inscripciones</th>';
    h += '</tr></thead><tbody>';

    actInscOrd.forEach(function(act) {
      h += '<tr><td style="' + S.tdB + '">' + act + '</td>';
      h += '<td style="' + S.tdC + '">' + inscPorAct[act] + '</td></tr>';
    });

    h += '</tbody><tfoot><tr style="background:#f1f5f9">';
    h += '<td style="padding:10px 14px;font-weight:700">TOTAL</td>';
    h += '<td style="padding:10px 14px;text-align:center;font-weight:700">' + inscripciones.length + '</td>';
    h += '</tr></tfoot></table>';
  }

  // ══ LEGALIZACIONES PENDIENTES ══
  if (pendIglesia > 0 || pendAcademia > 0) {
    h += '<div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-top:24px">';
    h += '<h3 style="margin:0 0 8px;font-size:14px;color:#92400e">⚠️ Legalizaciones Pendientes</h3>';
    if (pendIglesia > 0)  h += '<p style="margin:4px 0;font-size:13px;color:#78350f">Iglesia: <strong>' + pendIglesia + '</strong> transacción(es)</p>';
    if (pendAcademia > 0) h += '<p style="margin:4px 0;font-size:13px;color:#78350f">Academia: <strong>' + pendAcademia + '</strong> transacción(es)</p>';
    h += '</div>';
  }

  // ══ CTA ══
  h += '<div style="margin-top:20px;text-align:center">';
  h += '<p style="font-size:11px;color:#94a3b8;margin:0 0 10px">El detalle transacción por transacción está disponible en el reporte completo.</p>';
  h += '<a href="' + opts.sheetUrl + '" style="display:inline-block;background:#667eea;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">Ver reporte completo en Sheets →</a>';
  h += '</div>';

  h += '</div>';

  h += '<div style="background:#f8fafc;padding:10px 20px;text-align:center;font-size:10px;color:#94a3b8">';
  h += 'Punto de Información · Manantial de Vida Eterna';
  h += '</div></div></body></html>';

  return h;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES DE HOJAS DE CIERRE
// ═══════════════════════════════════════════════════════════════════════════════
const CIERRE_DATAFONO_SHEET_ID = '1GnCSSsVp_bRcBGSbe6D9XpZN4-Z87iB-DNzi0be9dxY';
const CIERRE_GENERAL_SHEET_ID = '17eM2YYQHXoMjV-dttSsGjEutL-llatbUo1rwfdRCuNU';
const CIERRE_GENERAL_EMAIL    = 'elcamino.norte@manantial.co';

// ═══════════════════════════════════════════════════════════════════════════════
// CIERRE MANUAL POR SEDE — Invocado desde la vista del asesor
// ═══════════════════════════════════════════════════════════════════════════════

function generarCierreSede(sede) {
  if (!sede) throw new Error('Sede es requerida');

  const ahora  = new Date();
  const tz     = 'America/Bogota';
  const hoy    = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const finDia = new Date(hoy);
  finDia.setHours(23, 59, 59, 999);

  const todasTransDiaSede = sheetToObjects_('Transacciones')
    .filter(t => t.Timestamp &&
      new Date(t.Timestamp) >= hoy && new Date(t.Timestamp) <= finDia &&
      t.Sede === sede);

  const todasTrans = todasTransDiaSede.filter(t => (t.Estado || 'Activa') !== 'Anulada');
  const transAnuladasSede = todasTransDiaSede.filter(t => t.Estado === 'Anulada');

  if (!todasTrans.length) {
    throw new Error('No hay transacciones hoy para la sede ' + sede);
  }

  const inscripcionesSede = sheetToObjects_('Inscripciones')
    .filter(i => i.Fecha && new Date(i.Fecha) >= hoy && new Date(i.Fecha) <= finDia && i.Sede === sede);

  todasTrans.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

  const nombrePestana = Utilities.formatDate(ahora, tz, 'dd-MM-yyyy') + ' - ' + sede;
  const fechaGen      = Utilities.formatDate(ahora, tz, 'dd/MM/yyyy HH:mm');
  const fmtM = v => '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v || 0);

  // ── HOJA 1: CIERRE DATÁFONO ──────────────────────────────────────────────
  const transDatafono = todasTrans.filter(t => t.Metodo_Pago === 'Datáfono');

  if (transDatafono.length) {
    const ssDf = SpreadsheetApp.openById(CIERRE_DATAFONO_SHEET_ID);
    let sheetDf = ssDf.getSheetByName(nombrePestana);
    if (sheetDf) sheetDf.clear();
    else sheetDf = ssDf.insertSheet(nombrePestana, 0);

    const porDatafono = {};
    transDatafono.forEach(t => {
      const num = t.Datafono_No_Datafono || 'Sin asignar';
      if (!porDatafono[num]) porDatafono[num] = [];
      porDatafono[num].push(t);
    });
    const datafonos = Object.keys(porDatafono).sort();

    const headersDf = [
      'FECHA DATÁFONO','FRANQUICIA','N° AUTORIZACIÓN','VALOR',
      'NOMBRE TITULAR','CÉDULA','CELULAR',
      'BENEFICIARIO DE PAGO','CÉDULA DE BENEFICIARIO','CELULAR DE BENEFICIARIO',
      'CONCEPTO','DÉBITO/CRÉDITO','ASESOR'
    ];
    const totalColsDf = headersDf.length;

    function mapRowDf_(t) {
      var td = resolverTitularBeneficiario_(t);
      return [
        t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
        t.Datafono_Franquicia           || '',
        t.Datafono_No_Autorizacion      || '',
        Number(t.Datafono_Valor)        || 0,
        td.titular, td.titularDoc, td.titularCel,
        td.benef, td.benefDoc, td.benefCel,
        t.Actividad                     || '',
        t.Datafono_Tipo_Tarjeta         || '',
        t.Asesor_Nombre                 || ''
      ];
    }

    const rowsDf = [];
    const mergesDf = [];
    const headerRowsDf = [];
    const dfHeaderRows = [];
    const subtotalRowsDf = [];

    rowsDf.push(['CIERRE DATÁFONO — ' + sede, ...Array(totalColsDf - 1).fill('')]);
    mergesDf.push(rowsDf.length);
    rowsDf.push(['Generado: ' + fechaGen, ...Array(totalColsDf - 1).fill('')]);
    mergesDf.push(rowsDf.length);
    rowsDf.push(Array(totalColsDf).fill(''));

    // Resumen por datáfono
    rowsDf.push(['DATÁFONO', 'N° TRANSACCIONES', 'TOTAL', ...Array(totalColsDf - 3).fill('')]);
    headerRowsDf.push(rowsDf.length);

    let totalGeneralDf = 0;
    datafonos.forEach(num => {
      const items = porDatafono[num];
      const totalDf = items.reduce((s, t) => s + (Number(t.Datafono_Valor) || 0), 0);
      totalGeneralDf += totalDf;
      rowsDf.push(['Datáfono #' + num, items.length, totalDf, ...Array(totalColsDf - 3).fill('')]);
    });

    rowsDf.push(['TOTAL DATÁFONO', transDatafono.length, totalGeneralDf, ...Array(totalColsDf - 3).fill('')]);
    subtotalRowsDf.push(rowsDf.length);

    // Bloques por datáfono
    datafonos.forEach(num => {
      const items = porDatafono[num];
      const totalDf = items.reduce((s, t) => s + (Number(t.Datafono_Valor) || 0), 0);

      rowsDf.push(Array(totalColsDf).fill(''));
      rowsDf.push(Array(totalColsDf).fill(''));

      rowsDf.push(['💳 Datáfono #' + num + ' — ' + items.length + ' transacción(es)', ...Array(totalColsDf - 1).fill('')]);
      dfHeaderRows.push(rowsDf.length);
      mergesDf.push(rowsDf.length);

      rowsDf.push(headersDf);
      headerRowsDf.push(rowsDf.length);

      items.forEach(t => rowsDf.push(mapRowDf_(t)));

      const subDf = Array(totalColsDf).fill('');
      subDf[0] = 'SUBTOTAL Datáfono #' + num;
      subDf[3] = totalDf;
      rowsDf.push(subDf);
      subtotalRowsDf.push(rowsDf.length);
    });

    // Gran total
    rowsDf.push(Array(totalColsDf).fill(''));
    const gtRowDf = Array(totalColsDf).fill('');
    gtRowDf[0] = 'GRAN TOTAL DATÁFONO — ' + sede;
    gtRowDf[3] = totalGeneralDf;
    rowsDf.push(gtRowDf);
    subtotalRowsDf.push(rowsDf.length);

    sheetDf.getRange(1, 1, rowsDf.length, totalColsDf).setValues(rowsDf);

    sheetDf.getRange(1, 1).setFontSize(14).setFontWeight('bold').setFontColor('#667eea');
    sheetDf.getRange(2, 1).setFontSize(9).setFontColor('#888888');

    mergesDf.forEach(r => sheetDf.getRange(r, 1, 1, totalColsDf).merge());
    headerRowsDf.forEach(r => {
      sheetDf.getRange(r, 1, 1, totalColsDf).setBackground('#2d3640').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
    });
    dfHeaderRows.forEach(r => {
      sheetDf.getRange(r, 1, 1, totalColsDf).setBackground('#667eea').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
    });
    subtotalRowsDf.forEach(r => {
      sheetDf.getRange(r, 1, 1, totalColsDf).setFontWeight('bold').setBackground('#f0f0f0').setBorder(true, true, true, true, false, false);
    });
    sheetDf.getRange(1, 4, rowsDf.length, 1).setNumberFormat('$ #,##0');
    for (let c = 1; c <= totalColsDf; c++) sheetDf.autoResizeColumn(c);
  }

  // ── HOJA 2: CIERRE GENERAL ───────────────────────────────────────────────
  const ssGen = SpreadsheetApp.openById(CIERRE_GENERAL_SHEET_ID);
  let sheetGen = ssGen.getSheetByName(nombrePestana);
  if (sheetGen) sheetGen.clear();
  else sheetGen = ssGen.insertSheet(nombrePestana, 0);

  const headersGen = [
    'FECHA','PERSONA','CÉDULA','CELULAR','ACTIVIDAD','MONTO','MÉTODO DE PAGO','ASESOR',
    'FRANQUICIA','N° AUTORIZACIÓN','VALOR DATÁFONO',
    'TITULAR TARJETA','CÉDULA TITULAR','CELULAR TITULAR',
    'DÉBITO/CRÉDITO','N° DATÁFONO'
  ];
  const totalColsGen = headersGen.length;
  const colMontoGen = 5;

  function mapRowGen_(t) {
    var td = resolverTitularBeneficiario_(t);
    return [
      t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
      t.Nombre_Persona                || '',
      t.Documento_Persona             || '',
      t.Celular_Persona               || '',
      t.Actividad                     || '',
      Number(t.Monto)                 || 0,
      t.Metodo_Pago                   || '',
      t.Asesor_Nombre                 || '',
      t.Datafono_Franquicia           || '',
      t.Datafono_No_Autorizacion      || '',
      Number(t.Datafono_Valor)        || 0,
      td.titular, td.titularDoc, td.titularCel,
      t.Datafono_Tipo_Tarjeta         || '',
      t.Datafono_No_Datafono          || ''
    ];
  }

  var totEfectivo = 0, totDatafono = 0, totNequi = 0, totTotal = 0;
  todasTrans.forEach(tr => {
    var m = Number(tr.Monto) || 0;
    totTotal += m;
    if (tr.Metodo_Pago === 'Efectivo')  totEfectivo += m;
    if (tr.Metodo_Pago === 'Datáfono')  totDatafono += m;
    if (tr.Metodo_Pago === 'Nequi')     totNequi    += m;
  });

  const rowsGen = [];
  const mergesGen = [];
  const headerRowsGen = [];
  const sedeHeaderRowsGen = [];
  const subtotalRowsGen = [];

  rowsGen.push(['CIERRE DIARIO — ' + sede, ...Array(totalColsGen - 1).fill('')]);
  mergesGen.push(rowsGen.length);
  rowsGen.push(['Generado: ' + fechaGen, ...Array(totalColsGen - 1).fill('')]);
  mergesGen.push(rowsGen.length);
  rowsGen.push(Array(totalColsGen).fill(''));

  // Resumen por método
  rowsGen.push(['MÉTODO', 'N° TRANS.', 'TOTAL', ...Array(totalColsGen - 3).fill('')]);
  headerRowsGen.push(rowsGen.length);

  var countEf = todasTrans.filter(t => t.Metodo_Pago === 'Efectivo').length;
  var countDf = todasTrans.filter(t => t.Metodo_Pago === 'Datáfono').length;
  var countNq = todasTrans.filter(t => t.Metodo_Pago === 'Nequi').length;

  rowsGen.push(['Efectivo', countEf, totEfectivo, ...Array(totalColsGen - 3).fill('')]);
  rowsGen.push(['Datáfono', countDf, totDatafono, ...Array(totalColsGen - 3).fill('')]);
  rowsGen.push(['Nequi', countNq, totNequi, ...Array(totalColsGen - 3).fill('')]);
  rowsGen.push(['TOTAL', todasTrans.length, totTotal, ...Array(totalColsGen - 3).fill('')]);
  subtotalRowsGen.push(rowsGen.length);
  const methodEndRow = rowsGen.length;

  // ── RESUMEN POR ACTIVIDAD ──
  rowsGen.push(Array(totalColsGen).fill(''));
  rowsGen.push(Array(totalColsGen).fill(''));
  rowsGen.push(['📋 RESUMEN POR ACTIVIDAD', ...Array(totalColsGen - 1).fill('')]);
  sedeHeaderRowsGen.push(rowsGen.length);
  mergesGen.push(rowsGen.length);

  rowsGen.push(['ACTIVIDAD', 'N° TRANS.', 'TOTAL', '%', 'TICKET PROM.', ...Array(totalColsGen - 5).fill('')]);
  headerRowsGen.push(rowsGen.length);
  const actStartRowGen = rowsGen.length;

  const porActividadGen = {};
  todasTrans.forEach(t => {
    const a = t.Actividad || 'Sin actividad';
    if (!porActividadGen[a]) porActividadGen[a] = { total: 0, count: 0 };
    porActividadGen[a].total += Number(t.Monto) || 0;
    porActividadGen[a].count++;
  });
  Object.keys(porActividadGen)
    .sort((a, b) => porActividadGen[b].total - porActividadGen[a].total)
    .forEach(act => {
      const d = porActividadGen[act];
      rowsGen.push([act, d.count, d.total, totTotal ? ((d.total / totTotal) * 100).toFixed(1) + '%' : '0%', Math.round(d.total / d.count), ...Array(totalColsGen - 5).fill('')]);
    });
  rowsGen.push(['TOTAL', todasTrans.length, totTotal, '100%', Math.round(totTotal / (todasTrans.length || 1)), ...Array(totalColsGen - 5).fill('')]);
  subtotalRowsGen.push(rowsGen.length);
  const actEndRowGen = rowsGen.length;

  // ── RENDIMIENTO POR ASESOR ──
  rowsGen.push(Array(totalColsGen).fill(''));
  rowsGen.push(Array(totalColsGen).fill(''));
  rowsGen.push(['👥 RENDIMIENTO POR ASESOR', ...Array(totalColsGen - 1).fill('')]);
  sedeHeaderRowsGen.push(rowsGen.length);
  mergesGen.push(rowsGen.length);

  rowsGen.push(['ASESOR', 'N° TRANS.', 'TOTAL', '%', 'TICKET PROM.', ...Array(totalColsGen - 5).fill('')]);
  headerRowsGen.push(rowsGen.length);
  const asesorStartRowGen = rowsGen.length;

  const porAsesorGen = {};
  todasTrans.forEach(t => {
    const key = t.Asesor_Email || 'desconocido';
    if (!porAsesorGen[key]) porAsesorGen[key] = { nombre: t.Asesor_Nombre || key, total: 0, count: 0 };
    porAsesorGen[key].total += Number(t.Monto) || 0;
    porAsesorGen[key].count++;
  });
  Object.keys(porAsesorGen)
    .sort((a, b) => porAsesorGen[b].total - porAsesorGen[a].total)
    .forEach(key => {
      const d = porAsesorGen[key];
      rowsGen.push([d.nombre, d.count, d.total, totTotal ? ((d.total / totTotal) * 100).toFixed(1) + '%' : '0%', Math.round(d.total / d.count), ...Array(totalColsGen - 5).fill('')]);
    });
  rowsGen.push(['TOTAL', todasTrans.length, totTotal, '100%', Math.round(totTotal / (todasTrans.length || 1)), ...Array(totalColsGen - 5).fill('')]);
  subtotalRowsGen.push(rowsGen.length);
  const asesorEndRowGen = rowsGen.length;

  // ── TRANSACCIONES ANULADAS ──
  let anuladasStartRowGen = 0, anuladasEndRowGen = 0;
  if (transAnuladasSede.length) {
    rowsGen.push(Array(totalColsGen).fill(''));
    rowsGen.push(Array(totalColsGen).fill(''));
    rowsGen.push(['❌ TRANSACCIONES ANULADAS (' + transAnuladasSede.length + ')', ...Array(totalColsGen - 1).fill('')]);
    sedeHeaderRowsGen.push(rowsGen.length);
    mergesGen.push(rowsGen.length);

    rowsGen.push(['FECHA', 'PERSONA', 'CÉDULA', 'ACTIVIDAD', 'MONTO', 'MÉTODO', 'ASESOR', ...Array(totalColsGen - 7).fill('')]);
    headerRowsGen.push(rowsGen.length);
    anuladasStartRowGen = rowsGen.length;

    transAnuladasSede.forEach(t => {
      rowsGen.push([
        t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
        t.Nombre_Persona || '', t.Documento_Persona || '', t.Actividad || '',
        Number(t.Monto) || 0, t.Metodo_Pago || '', t.Asesor_Nombre || '',
        ...Array(totalColsGen - 7).fill('')
      ]);
    });

    const totalAnuladoGen = transAnuladasSede.reduce((s, t) => s + (Number(t.Monto) || 0), 0);
    rowsGen.push(['TOTAL ANULADO', '', '', '', totalAnuladoGen, '', '', ...Array(totalColsGen - 7).fill('')]);
    subtotalRowsGen.push(rowsGen.length);
    anuladasEndRowGen = rowsGen.length;
  }

  // Tabla de transacciones
  rowsGen.push(Array(totalColsGen).fill(''));
  rowsGen.push(Array(totalColsGen).fill(''));

  rowsGen.push(['📍 ' + sede + ' — ' + todasTrans.length + ' transacción(es)', ...Array(totalColsGen - 1).fill('')]);
  sedeHeaderRowsGen.push(rowsGen.length);
  mergesGen.push(rowsGen.length);

  rowsGen.push(headersGen);
  headerRowsGen.push(rowsGen.length);

  todasTrans.forEach(tr => rowsGen.push(mapRowGen_(tr)));

  var subGen = Array(totalColsGen).fill('');
  subGen[0] = 'TOTAL ' + sede;
  subGen[colMontoGen] = totTotal;
  rowsGen.push(subGen);
  subtotalRowsGen.push(rowsGen.length);

  sheetGen.getRange(1, 1, rowsGen.length, totalColsGen).setValues(rowsGen);

  sheetGen.getRange(1, 1).setFontSize(14).setFontWeight('bold').setFontColor('#667eea');
  sheetGen.getRange(2, 1).setFontSize(9).setFontColor('#888888');

  mergesGen.forEach(r => sheetGen.getRange(r, 1, 1, totalColsGen).merge());
  headerRowsGen.forEach(r => {
    sheetGen.getRange(r, 1, 1, totalColsGen).setBackground('#2d3640').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  });
  sedeHeaderRowsGen.forEach(r => {
    sheetGen.getRange(r, 1, 1, totalColsGen).setBackground('#667eea').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  });
  subtotalRowsGen.forEach(r => {
    sheetGen.getRange(r, 1, 1, totalColsGen).setFontWeight('bold').setBackground('#f0f0f0').setBorder(true, true, true, true, false, false);
  });

  // Formato moneda por sección (evita aplicar moneda a CÉDULA/CELULAR en detalle)
  sheetGen.getRange(4, 3, methodEndRow - 3, 1).setNumberFormat('$ #,##0');
  sheetGen.getRange(actStartRowGen, 3, actEndRowGen - actStartRowGen + 1, 1).setNumberFormat('$ #,##0');
  sheetGen.getRange(actStartRowGen, 5, actEndRowGen - actStartRowGen + 1, 1).setNumberFormat('$ #,##0');
  sheetGen.getRange(asesorStartRowGen, 3, asesorEndRowGen - asesorStartRowGen + 1, 1).setNumberFormat('$ #,##0');
  sheetGen.getRange(asesorStartRowGen, 5, asesorEndRowGen - asesorStartRowGen + 1, 1).setNumberFormat('$ #,##0');
  if (transAnuladasSede.length) sheetGen.getRange(anuladasStartRowGen, 5, anuladasEndRowGen - anuladasStartRowGen + 1, 1).setNumberFormat('$ #,##0');
  sheetGen.getRange(1, colMontoGen + 1, rowsGen.length, 1).setNumberFormat('$ #,##0');
  sheetGen.getRange(1, 11, rowsGen.length, 1).setNumberFormat('$ #,##0');

  for (var c = 1; c <= totalColsGen; c++) sheetGen.autoResizeColumn(c);

  // ── CORREO GERENCIAL ──────────────────────────────────────────────────
  var sheetUrl = 'https://docs.google.com/spreadsheets/d/' + CIERRE_GENERAL_SHEET_ID + '/edit#gid=' + sheetGen.getSheetId();
  var nombreFecha = Utilities.formatDate(ahora, tz, 'dd-MM-yyyy');

  var emailHtml = buildEmailCierreGerencial_({
    titulo:        'Cierre Diario — ' + sede,
    fecha:         nombreFecha,
    fechaGen:      fechaGen,
    trans:         todasTrans,
    anuladas:      transAnuladasSede,
    inscripciones: inscripcionesSede,
    sheetUrl:      sheetUrl,
    mostrarSedes:  false
  });

  MailApp.sendEmail({
    to:       CIERRE_GENERAL_EMAIL,
    subject:  '📊 Cierre ' + sede + ' ' + nombreFecha + ' — ' + todasTrans.length + ' trans · ' + fmtM(totTotal),
    htmlBody: emailHtml
  });

  Logger.log('Cierre sede ' + sede + ' ' + nombreFecha + ': ' + todasTrans.length + ' trans. Total: ' + totTotal);
  return { ok: true, mensaje: 'Cierre generado para ' + sede };
}
