// ─── EMAIL.GS ─────────────────────────────────────────────────────────────────
// Contrato público:
//   enviarConfirmacion(datos) → {ok:boolean}
//
// datos: {nombre, correo, actividad, monto, metodo, asesor, fecha, periodo}

/**
 * Envía email de confirmación al correo de la persona registrada.
 * Usa GmailApp.sendEmail() — requiere scope gmail.send.
 * @param {{nombre:string, correo:string, actividad:string, monto:number,
 *          metodo:string, asesor:string, fecha:string, periodo:string}} datos
 * @returns {{ok:boolean}}
 */
function enviarConfirmacion(datos) {
  if (!datos.correo) return { ok: false, razon: 'Sin correo' };

  const asunto = `Confirmación de pago – ${datos.actividad} | Iglesia Manantial`;
  const montoFormateado = formatMoneyCOP_(datos.monto);

  const cuerpoHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; margin: 0; padding: 20px; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px;
                 overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #0d1829 0%, #667eea 100%);
              padding: 32px 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 0.5px; }
    .header p  { color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 13px; }
    .body { padding: 32px 24px; }
    .greeting { font-size: 16px; color: #1a202c; margin-bottom: 24px; }
    .card { background: #f7f9fc; border: 1px solid #e2e8f0; border-radius: 8px;
            padding: 20px; margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; align-items: center;
           padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .row:last-child { border-bottom: none; }
    .label { color: #718096; font-size: 13px; }
    .value { color: #1a202c; font-size: 14px; font-weight: 600; }
    .monto { font-size: 22px; color: #667eea; font-weight: 700; }
    .footer { background: #f7f9fc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { color: #718096; font-size: 12px; margin: 4px 0; }
    .badge { display: inline-block; background: #c6f6d5; color: #276749;
             padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://www.soymanantial.com/footer/50.svg" alt="Manantial" style="height:30px;margin-bottom:12px">
      <h1>✅ Pago Confirmado</h1>
      <p>Punto de Información</p>
    </div>
    <div class="body">
      <p class="greeting">Hola, <strong>${escapeHtml_(datos.nombre)}</strong>. Tu pago ha sido registrado exitosamente.</p>
      <div class="card">
        <div class="row">
          <span class="label">Actividad</span>
          <span class="value">${escapeHtml_(datos.actividad)}</span>
        </div>
        <div class="row">
          <span class="label">Monto</span>
          <span class="value monto">${montoFormateado}</span>
        </div>
        <div class="row">
          <span class="label">Método de pago</span>
          <span class="value">${escapeHtml_(datos.metodo)}</span>
        </div>
        <div class="row">
          <span class="label">Fecha y hora</span>
          <span class="value">${escapeHtml_(datos.fecha)}</span>
        </div>
        ${datos.periodo ? `
        <div class="row">
          <span class="label">Periodo</span>
          <span class="value">${escapeHtml_(datos.periodo)}</span>
        </div>` : ''}
        <div class="row">
          <span class="label">Asesor</span>
          <span class="value">${escapeHtml_(datos.asesor)}</span>
        </div>
        <div class="row">
          <span class="label">Estado</span>
          <span class="badge">Registrado</span>
        </div>
      </div>
      <p style="color:#718096;font-size:13px;line-height:1.6;">
        Conserva este correo como comprobante. Si tienes alguna pregunta,
        comunícate con tu asesor del punto de información de tu sede.
      </p>
    </div>
    <div class="footer">
      <p><strong>Iglesia Manantial de Vida Eterna</strong></p>
      <p>Sedes Norte y Suba · Bogotá, Colombia</p>
      <p style="margin-top:8px;font-size:11px;">Este es un mensaje automático. No respondas a este correo.</p>
    </div>
  </div>
</body>
</html>`;

  const cuerpoTexto = `
Confirmación de pago – Iglesia Manantial

Hola ${datos.nombre},

Tu pago ha sido registrado exitosamente.

Actividad:      ${datos.actividad}
Monto:          ${montoFormateado}
Método de pago: ${datos.metodo}
Fecha:          ${datos.fecha}
Periodo:        ${datos.periodo || 'N/A'}
Asesor:         ${datos.asesor}

Conserva este correo como comprobante.

Iglesia Manantial – Punto de Información
  `.trim();

  try {
    GmailApp.sendEmail(datos.correo, asunto, cuerpoTexto, {
      htmlBody: cuerpoHtml,
      name:     'Iglesia Manantial Sedes Norte y Suba',
      noReply:  true
    });
    return { ok: true };
  } catch (e) {
    Logger.log('Error enviando email a ' + datos.correo + ': ' + e.message);
    return { ok: false, razon: e.message };
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
// escapeHtml_ vive en Auth.js (helpers compartidos) — no se redefine aquí para
// evitar una colisión silenciosa de nombre en el namespace global de Apps Script.

function formatMoneyCOP_(monto) {
  return new Intl.NumberFormat('es-CO', {
    style:    'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(monto) || 0);
}
