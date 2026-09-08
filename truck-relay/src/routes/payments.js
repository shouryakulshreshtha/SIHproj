/**
 * routes/payments.js
 * Client flow (Razorpay Checkout, standard integration):
 *   1. POST /api/payments/bookings          -> get order.id for the advance leg
 *   2. Frontend opens Razorpay Checkout with that order.id
 *   3. On success, frontend calls POST /api/payments/verify to confirm
 *      (webhook in routes/webhooks.js is the SOURCE OF TRUTH — this verify
 *      step is just for fast UI feedback, don't skip the webhook handler)
 *   4. Later, when balance is due: POST /api/payments/bookings/:id/balance-order
 */

const express = require('express');
const {
  createBookingWithAdvanceOrder,
  createBalanceOrder,
  verifyCheckoutSignature,
} = require('../services/razorpayService');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/bookings', requireAuth, async (req, res) => {
  const { tripId, totalAmountPaise } = req.body;
  if (!tripId || !Number.isInteger(totalAmountPaise) || totalAmountPaise <= 0) {
    return res.status(400).json({ error: 'tripId and positive integer totalAmountPaise required' });
  }

  const result = await createBookingWithAdvanceOrder({
    customerId: req.user.id,
    tripId,
    totalAmountPaise,
  });

  res.status(201).json({
    bookingId: result.bookingId,
    order: {
      id: result.advanceOrder.id,
      amount: result.advanceOrder.amount,
      currency: result.advanceOrder.currency,
    },
    // Frontend needs this to open Razorpay Checkout:
    keyId: process.env.RAZORPAY_KEY_ID,
  });
});

router.post('/bookings/:bookingId/balance-order', requireAuth, async (req, res) => {
  const { bookingId } = req.params;

  const { rows } = await pool.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
  if (!rows[0]) return res.status(404).json({ error: 'booking not found' });
  if (rows[0].status !== 'in_transit' && rows[0].status !== 'pending_balance') {
    return res.status(409).json({ error: `cannot create balance order in status ${rows[0].status}` });
  }

  const order = await createBalanceOrder(bookingId);
  res.status(201).json({
    order: { id: order.id, amount: order.amount, currency: order.currency },
    keyId: process.env.RAZORPAY_KEY_ID,
  });
});

// Client-side confirmation, purely for fast UI feedback.
// The webhook (routes/webhooks.js) remains the authoritative source
// for actually marking a payment as paid.
router.post('/verify', requireAuth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature })) {
    return res.status(400).json({ error: 'invalid signature' });
  }

  res.json({ verified: true, note: 'final confirmation will arrive via webhook' });
});

module.exports = router;
