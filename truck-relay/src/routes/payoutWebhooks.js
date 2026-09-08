/**
 * routes/payoutWebhooks.js — Razorpay Payouts (RazorpayX) webhook
 * ------------------------------------------------------------------
 * Same idempotency pattern as routes/webhooks.js (atomic insert into
 * processed_webhook_events, business logic in the same transaction),
 * kept as a separate endpoint because RazorpayX payouts typically use
 * a distinct webhook secret from standard Payments.
 *
 * Events handled: payout.processed, payout.failed, payout.reversed
 * ------------------------------------------------------------------
 */

const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');

const router = express.Router();
const PAYOUT_WEBHOOK_SECRET = process.env.RAZORPAYX_WEBHOOK_SECRET;

router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body;

  if (!verifySignature(rawBody, signature)) {
    return res.status(400).json({ error: 'invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'malformed payload' });
  }

  const eventId = req.headers['x-razorpay-event-id'] || `${payload.event}:${payload.payload?.payout?.entity?.id}`;
  const eventType = payload.event;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO processed_webhook_events (event_id, event_type)
       VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId, eventType]
    );

    if (insertResult.rowCount === 1) {
      await applyPayoutEvent(client, eventType, payload);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[payout webhook] processing failed:', err);
    return res.status(500).json({ error: 'processing failed' });
  } finally {
    client.release();
  }

  res.status(200).json({ received: true });
});

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', PAYOUT_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function applyPayoutEvent(client, eventType, payload) {
  const payout = payload.payload.payout.entity;

  switch (eventType) {
    case 'payout.processed': {
      await client.query(
        `UPDATE driver_payouts SET status = 'processed', updated_at = now() WHERE razorpay_payout_id = $1`,
        [payout.id]
      );
      await client.query(
        `UPDATE driver_earnings SET status = 'paid_out'
         WHERE payout_id = (SELECT id FROM driver_payouts WHERE razorpay_payout_id = $1)`,
        [payout.id]
      );
      break;
    }

    case 'payout.failed':
    case 'payout.reversed': {
      await client.query(
        `UPDATE driver_payouts SET status = 'failed', failure_reason = $1, updated_at = now()
         WHERE razorpay_payout_id = $2`,
        [payout.failure_reason || eventType, payout.id]
      );
      // Put the earnings back to 'pending' so the next payout run retries them
      // (with a fresh idempotency key, since the batch — and thus the fingerprint — changes).
      await client.query(
        `UPDATE driver_earnings SET status = 'pending', payout_id = NULL
         WHERE payout_id = (SELECT id FROM driver_payouts WHERE razorpay_payout_id = $1)`,
        [payout.id]
      );
      break;
    }

    default:
      console.log(`[payout webhook] unhandled event type: ${eventType}`);
  }
}

module.exports = router;
