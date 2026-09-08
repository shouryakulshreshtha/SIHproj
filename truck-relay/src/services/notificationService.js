/**
 * notificationService.js — the ONE function every other service should
 * call to notify someone. Don't call pushProvider/smsProvider/
 * whatsappProvider directly from elsewhere in the codebase — route
 * through here so every notification gets logged consistently and
 * channel fallback logic lives in one place.
 *
 * Usage from anywhere else in the app:
 *   const { notify } = require('../services/notificationService');
 *   await notify({
 *     recipientType: 'customer',
 *     recipientId: booking.customer_id,
 *     channels: ['push', 'sms'],
 *     templateKey: 'driver_assigned',
 *     data: { driverName, eta },
 *   });
 * ------------------------------------------------------------------
 */

const pool = require('../db/pool');
const { sendPush } = require('./notifications/pushProvider');
const { sendSms } = require('./notifications/smsProvider');
const { sendWhatsapp } = require('./notifications/whatsappProvider');

// Add new event types here — one place to define what each channel says.
const TEMPLATES = {
  booking_confirmed: {
    title: 'Booking confirmed',
    render: (d) => `Your booking #${d.bookingId} is confirmed. Total: ₹${(d.totalPaise / 100).toFixed(2)}`,
  },
  driver_assigned: {
    title: 'Driver assigned',
    render: (d) => `${d.driverName} has been assigned to your shipment. ETA to pickup: ${d.eta}`,
  },
  shift_handoff: {
    title: 'Driver changed',
    render: (d) => `Your shipment now has a new driver, ${d.driverName}, continuing the journey.`,
  },
  payment_captured: {
    title: 'Payment received',
    render: (d) => `We received your payment of ₹${(d.amountPaise / 100).toFixed(2)} for booking #${d.bookingId}.`,
  },
  invoice_issued: {
    title: 'Invoice issued',
    render: (d) => `Invoice ${d.invoiceNumber} for ₹${(d.totalPaise / 100).toFixed(2)} has been issued. Due ${d.dueDate}.`,
  },
  detention_charged: {
    title: 'Detention charge applied',
    render: (d) => `A detention charge of ₹${(d.amountPaise / 100).toFixed(2)} was added to booking #${d.bookingId}.`,
  },
  booking_cancelled: {
    title: 'Booking cancelled',
    render: (d) => `Booking #${d.bookingId} was cancelled. Cancellation fee: ₹${(d.feePaise / 100).toFixed(2)}.`,
  },
};

/**
 * Sends a notification across one or more channels. Each channel is
 * attempted independently and logged independently — a push failure
 * doesn't block the SMS from going out.
 */
async function notify({ recipientType, recipientId, channels, templateKey, data = {}, phone }) {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`unknown notification template: ${templateKey}`);
  const message = template.render(data);

  const results = await Promise.all(
    channels.map((channel) => sendOnChannel({ channel, recipientType, recipientId, templateKey, message, title: template.title, phone }))
  );

  return results;
}

async function sendOnChannel({ channel, recipientType, recipientId, templateKey, message, title, phone }) {
  const logId = await logAttempt({ recipientType, recipientId, channel, templateKey, message });

  try {
    let providerResult;

    if (channel === 'push') {
      const { rows: tokens } = await pool.query(`SELECT token FROM device_tokens WHERE user_id = $1`, [recipientId]);
      if (!tokens.length) throw new Error('no device tokens registered');
      const pushResult = await sendPush(tokens.map((t) => t.token), { title, body: message });
      if (pushResult.invalidTokens.length) {
        await pool.query(`DELETE FROM device_tokens WHERE token = ANY($1::text[])`, [pushResult.invalidTokens]);
      }
      providerResult = { providerMessageId: null, status: pushResult.failureCount === 0 ? 'sent' : 'partial' };
    } else if (channel === 'sms') {
      if (!phone) throw new Error('phone number required for sms channel');
      providerResult = await sendSms(phone, message);
    } else if (channel === 'whatsapp') {
      if (!phone) throw new Error('phone number required for whatsapp channel');
      providerResult = await sendWhatsapp(phone, message);
    } else {
      throw new Error(`unsupported channel: ${channel}`);
    }

    await markSent(logId, providerResult.providerMessageId);
    return { channel, status: 'sent' };
  } catch (err) {
    await markFailed(logId, err.message);
    console.error(`[notificationService] ${channel} send failed:`, err.message);
    return { channel, status: 'failed', error: err.message };
  }
}

async function logAttempt({ recipientType, recipientId, channel, templateKey, message }) {
  const { rows } = await pool.query(
    `INSERT INTO notification_log (recipient_type, recipient_id, channel, template_key, message)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [recipientType, recipientId, channel, templateKey, message]
  );
  return rows[0].id;
}

async function markSent(logId, providerMessageId) {
  await pool.query(
    `UPDATE notification_log SET status = 'sent', provider_message_id = $1, sent_at = now() WHERE id = $2`,
    [providerMessageId, logId]
  );
}

async function markFailed(logId, error) {
  await pool.query(`UPDATE notification_log SET status = 'failed', error = $1 WHERE id = $2`, [error, logId]);
}

async function registerDeviceToken(userId, platform, token) {
  await pool.query(
    `INSERT INTO device_tokens (user_id, platform, token) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, token) DO NOTHING`,
    [userId, platform, token]
  );
}

module.exports = { notify, registerDeviceToken };
