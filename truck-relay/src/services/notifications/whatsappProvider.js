/**
 * whatsappProvider.js — Twilio WhatsApp Business API adapter.
 * If you use Gupshup/Interakt/direct Meta Cloud API instead, swap the
 * internals here — the rest of the app only calls sendWhatsapp(to, message).
 *
 * NOTE: outside a 24hr customer-initiated session window, WhatsApp
 * requires using a pre-approved message TEMPLATE, not free-form text.
 * `templateName` + `templateParams` are provided for that case; pass
 * neither for a free-form message inside an active session.
 */

const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_WHATSAPP = process.env.TWILIO_WHATSAPP_FROM; // e.g. 'whatsapp:+14155238886'

async function sendWhatsapp(toE164, message, { templateSid, templateParams } = {}) {
  const payload = {
    from: FROM_WHATSAPP,
    to: `whatsapp:${toE164}`,
  };

  if (templateSid) {
    payload.contentSid = templateSid;
    payload.contentVariables = JSON.stringify(templateParams || {});
  } else {
    payload.body = message;
  }

  const result = await client.messages.create(payload);
  return { providerMessageId: result.sid, status: result.status };
}

module.exports = { sendWhatsapp };
