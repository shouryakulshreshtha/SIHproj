/**
 * cancellationService.js
 * ------------------------------------------------------------------
 * Maps the booking's current lifecycle status to a cancellation
 * stage, computes the fee from cancellationPolicy.js, and settles it
 * against whatever's already been paid (the advance).
 *
 * Booking lifecycle used here (extend routes/payments.js's status
 * transitions to actually set these as your dispatch flow progresses):
 *   pending_advance / advance_paid  -> stage 'booked'
 *   driver_assigned                 -> stage 'driver_assigned'
 *   en_route_pickup                 -> stage 'en_route_pickup'
 *   loaded_in_transit               -> stage 'loaded_in_transit'
 *
 * Settlement logic:
 *   - fee <= advance already paid  -> refund the difference to customer
 *   - fee  > advance already paid  -> nothing further auto-charged;
 *     flagged for manual/balance-order collection (rare — only happens
 *     at the highest-fee stage on a low advance %).
 * ------------------------------------------------------------------
 */

const Razorpay = require('razorpay');
const pool = require('../db/pool');
const { getStagePolicy } = require('../constants/cancellationPolicy');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const STATUS_TO_STAGE = {
  pending_advance: 'booked',
  advance_paid: 'booked',
  driver_assigned: 'driver_assigned',
  en_route_pickup: 'en_route_pickup',
  loaded_in_transit: 'loaded_in_transit',
};

async function cancelBooking(bookingId, { cancelledByRole }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    const booking = rows[0];
    if (!booking) throw new Error('booking not found');
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      throw new Error(`cannot cancel a booking in status ${booking.status}`);
    }

    const stage = STATUS_TO_STAGE[booking.status];
    if (!stage) throw new Error(`no cancellation stage mapped for booking status ${booking.status}`);

    const policy = getStagePolicy(stage);
    const feePaise = Math.round((booking.total_amount_paise * policy.feePercent) / 100);

    // How much has actually been captured so far (advance leg, if paid).
    const { rows: paymentRows } = await client.query(
      `SELECT amount_paise, razorpay_payment_id FROM payments
       WHERE booking_id = $1 AND leg = 'advance' AND status = 'paid'`,
      [bookingId]
    );
    const advancePaid = paymentRows[0];
    const advancePaidPaise = advancePaid ? Number(advancePaid.amount_paise) : 0;

    let refundPaise = 0;
    let outstandingFeePaise = 0;

    if (advancePaidPaise >= feePaise) {
      refundPaise = advancePaidPaise - feePaise;
    } else {
      outstandingFeePaise = feePaise - advancePaidPaise; // rare: fee exceeds what's collected
    }

    await client.query(
      `UPDATE bookings SET
         status = 'cancelled',
         cancelled_at = now(),
         cancellation_stage = $1,
         cancellation_fee_paise = $2,
         cancelled_by_role = $3
       WHERE id = $4`,
      [stage, feePaise, cancelledByRole, bookingId]
    );

    await client.query('COMMIT');

    // Issue the refund AFTER committing the cancellation state — if the
    // refund call fails, the booking is still correctly marked
    // cancelled and this can be retried/reconciled without re-deriving
    // the fee calculation.
    let refund = null;
    if (refundPaise > 0 && advancePaid?.razorpay_payment_id) {
      refund = await razorpay.payments.refund(advancePaid.razorpay_payment_id, {
        amount: refundPaise,
        notes: { bookingId, reason: `cancellation at stage ${stage}` },
      });
    }

    return {
      bookingId,
      stage,
      feePercent: policy.feePercent,
      feePaise,
      refundPaise,
      outstandingFeePaise,
      refundId: refund?.id || null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { cancelBooking };
