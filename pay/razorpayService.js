/**
 * razorpayService.js
 * ------------------------------------------------------------------
 * Handles the advance/balance split model:
 *   - "advance" order created (and expected to be paid) at booking time
 *   - "balance" order created once the trip is confirmed / delivered,
 *     for the remaining amount
 *
 * Both are separate Razorpay orders tied to the same booking, tracked
 * in the `payments` table via `leg` = 'advance' | 'balance'.
 * ------------------------------------------------------------------
 */

const Razorpay = require('razorpay');
const crypto = require('crypto');
const pool = require('../db/pool');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const ADVANCE_PERCENT = Number(process.env.ADVANCE_PERCENT || 30); // tune per your business model

/**
 * Creates a booking with the total amount split into advance + balance,
 * and creates the Razorpay order for the advance leg immediately.
 */
async function createBookingWithAdvanceOrder({ customerId, tripId, totalAmountPaise }) {
  const advanceAmountPaise = Math.round((totalAmountPaise * ADVANCE_PERCENT) / 100);
  const balanceAmountPaise = totalAmountPaise - advanceAmountPaise;

  const bookingResult = await pool.query(
    `INSERT INTO bookings (trip_id, customer_id, total_amount_paise, advance_amount_paise, balance_amount_paise)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [tripId, customerId, totalAmountPaise, advanceAmountPaise, balanceAmountPaise]
  );
  const bookingId = bookingResult.rows[0].id;

  const order = await createOrderForLeg(bookingId, 'advance', advanceAmountPaise);
  return { bookingId, advanceOrder: order, advanceAmountPaise, balanceAmountPaise };
}

/**
 * Creates the balance-leg order. Call this when the trip reaches the
 * point where the remaining amount becomes due (e.g. delivery confirmed).
 */
async function createBalanceOrder(bookingId) {
  const { rows } = await pool.query(`SELECT balance_amount_paise FROM bookings WHERE id = $1`, [bookingId]);
  if (!rows[0]) throw new Error('booking not found');
  return createOrderForLeg(bookingId, 'balance', rows[0].balance_amount_paise);
}

async function createOrderForLeg(bookingId, leg, amountPaise) {
  // Razorpay order `receipt` should be unique & traceable back to your system.
  const receipt = `${bookingId}-${leg}-${Date.now()}`;

  const order = await razorpay.orders.create({
    amount: amountPaise,       // Razorpay expects the smallest currency unit (paise)
    currency: 'INR',
    receipt,
    notes: { bookingId, leg },
  });

  await pool.query(
    `INSERT INTO payments (booking_id, leg, razorpay_order_id, amount_paise, status)
     VALUES ($1,$2,$3,$4,'created')`,
    [bookingId, leg, order.id, amountPaise]
  );

  return order; // contains order.id — hand this to the frontend Razorpay Checkout
}

/**
 * Verifies the signature Razorpay Checkout returns to the client after
 * a successful payment (NOT the webhook — see webhookService.js for that).
 * Always verify server-side before trusting a "payment succeeded" claim
 * from the client.
 */
function verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  return expected === razorpay_signature;
}

module.exports = {
  createBookingWithAdvanceOrder,
  createBalanceOrder,
  verifyCheckoutSignature,
};
