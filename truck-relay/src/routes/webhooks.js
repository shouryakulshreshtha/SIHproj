/**
 * routes/webhooks.js — Razorpay webhook receiver
 * ------------------------------------------------------------------
 * Razorpay WILL send the same event more than once (retries on
 * timeout, network blips, etc.), so this handler must be idempotent:
 * processing the same event twice must have the same effect as
 * processing it once.
 *
 * Idempotency strategy:
 *   1. Verify the HMAC signature (proves it's really from Razorpay).
 *   2. Try to INSERT the event id into processed_webhook_events.
 *      The PRIMARY KEY constraint makes this atomic — if the insert
 *      fails with a unique-violation, we've already handled this
 *      event, so we just return 200 and stop.
 *   3. Only if the insert succeeds do we apply the business logic
 *      (mark payment paid, update booking status, etc.), inside the
 *      SAME transaction as the insert — so a crash mid-processing
 *      can't leave us with "marked as processed but not applied".
 *
 * IMPORTANT: mount this route with express.raw({ type: 'application/json' }),
 * NOT express.json() — signature verification needs the exact raw body
 * bytes, not a re-serialized object.
 * ------------------------------------------------------------------
 */

const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');

const router = express.Router();
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body; // Buffer, thanks to express.raw()

  if (!verifySignature(rawBody, signature)) {
    return res.status(400).json({ error: 'invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'malformed payload' });
  }

  // Razorpay sends a stable event id per delivery attempt in this header;
  // fall back to a composite key from the payload if it's ever missing.
  const eventId = req.headers['x-razorpay-event-id'] || buildFallbackEventId(payload);
  const eventType = payload.event; // e.g. 'payment.captured', 'order.paid', 'payment.failed'

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Atomic dedup check: this INSERT either succeeds (first time we've
    // seen this event) or throws a unique-violation (we've seen it before).
    const insertResult = await client.query(
      `INSERT INTO processed_webhook_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, eventType]
    );

    const isFirstDelivery = insertResult.rowCount === 1;

    if (isFirstDelivery) {
      await applyEvent(client, eventType, payload);
    }
    // else: duplicate delivery — do nothing, but still return 200 below
    // so Razorpay stops retrying.

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[webhook] processing failed:', err);
    // Return 500 so Razorpay retries — safe because of the idempotency
    // check above; a retry after a genuine failure will try again cleanly.
    return res.status(500).json({ error: 'processing failed' });
  } finally {
    client.release();
  }

  res.status(200).json({ received: true });
});

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  // timing-safe compare
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

function buildFallbackEventId(payload) {
  const entityId =
    payload?.payload?.payment?.entity?.id ||
    payload?.payload?.order?.entity?.id ||
    'unknown';
  return `${payload.event}:${entityId}:${payload.created_at}`;
}

/**
 * Applies the business-logic side effects for a given event type.
 * Runs inside the same DB transaction as the dedup insert.
 */
async function applyEvent(client, eventType, payload) {
  switch (eventType) {
    case 'payment.captured': {
      const payment = payload.payload.payment.entity;
      const orderId = payment.order_id;

      const { rows } = await client.query(
        `UPDATE payments
         SET status = 'paid', razorpay_payment_id = $1, updated_at = now()
         WHERE razorpay_order_id = $2
         RETURNING booking_id, leg`,
        [payment.id, orderId]
      );

      if (rows[0]) {
        const { booking_id, leg } = rows[0];
        const newStatus = leg === 'advance' ? 'advance_paid' : 'completed';
        await client.query(`UPDATE bookings SET status = $1 WHERE id = $2`, [newStatus, booking_id]);
      }
      break;
    }

    case 'payment.failed': {
      const payment = payload.payload.payment.entity;
      await client.query(
        `UPDATE payments SET status = 'failed', updated_at = now() WHERE razorpay_order_id = $1`,
        [payment.order_id]
      );
      break;
    }

    default:
      // Log and ignore event types you're not handling yet — don't fail
      // the whole webhook because of an event you haven't wired up.
      console.log(`[webhook] unhandled event type: ${eventType}`);
  }
}

module.exports = router;
