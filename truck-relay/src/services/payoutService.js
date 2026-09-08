/**
 * payoutService.js — Driver payouts via Razorpay Payouts (RazorpayX)
 * ------------------------------------------------------------------
 * DESIGN: "no wallet balance" means we never hold driver earnings as
 * an internal ledger balance the driver "withdraws" from later.
 * Instead:
 *   1. Earnings accumulate as rows in `driver_earnings` (status='pending')
 *      as they're generated — end of shift, detention bonus, etc.
 *   2. Running a payout SUMS the pending rows for a driver and fires a
 *      single real bank transfer via Razorpay Payouts for that total.
 *   3. Those earning rows are marked 'queued' -> 'paid_out' (or
 *      'failed') based on the payout's actual outcome (via webhook).
 *
 * There's no "wallet balance" endpoint because there's nothing to
 * store — a driver's balance is just `SUM(pending earnings)`, computed
 * on demand.
 *
 * Razorpay Payouts requires a RazorpayX current account + its own
 * account number (different from the standard Payments key). Docs:
 * https://razorpay.com/docs/x/payout-links/ and /payouts/
 * ------------------------------------------------------------------
 */

const axios = require('axios');
const crypto = require('crypto');
const pool = require('../db/pool');

const razorpayX = axios.create({
  baseURL: 'https://api.razorpay.com/v1',
  auth: {
    username: process.env.RAZORPAYX_KEY_ID,
    password: process.env.RAZORPAYX_KEY_SECRET,
  },
});

const RAZORPAYX_ACCOUNT_NUMBER = process.env.RAZORPAYX_ACCOUNT_NUMBER; // the funding account payouts draw from

/**
 * One-time setup per driver: register their bank account or UPI VPA
 * as a Razorpay "contact" + "fund account". Call this when a driver
 * adds/updates their payout details in the app.
 */
async function registerDriverPayoutAccount(driverId, { name, email, contactNumber, bankAccount, vpa }) {
  const { data: contact } = await razorpayX.post('/contacts', {
    name,
    email,
    contact: contactNumber,
    type: 'employee', // or 'vendor' — pick whichever fits your Razorpay account setup
    reference_id: driverId,
  });

  const fundAccountPayload = bankAccount
    ? {
        contact_id: contact.id,
        account_type: 'bank_account',
        bank_account: {
          name: bankAccount.accountHolderName,
          ifsc: bankAccount.ifsc,
          account_number: bankAccount.accountNumber,
        },
      }
    : {
        contact_id: contact.id,
        account_type: 'vpa',
        vpa: { address: vpa },
      };

  const { data: fundAccount } = await razorpayX.post('/fund_accounts', fundAccountPayload);

  await pool.query(
    `INSERT INTO driver_payout_accounts (driver_id, razorpay_contact_id, razorpay_fund_account_id, account_type)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (driver_id) DO UPDATE SET
       razorpay_contact_id = EXCLUDED.razorpay_contact_id,
       razorpay_fund_account_id = EXCLUDED.razorpay_fund_account_id,
       account_type = EXCLUDED.account_type`,
    [driverId, contact.id, fundAccount.id, bankAccount ? 'bank_account' : 'vpa']
  );

  return fundAccount;
}

/**
 * Queues an earning for a driver. Call this whenever a driver earns
 * money — end of a 10hr shift, a detention bonus, etc. Doesn't move
 * any money by itself; just records that money is owed.
 */
async function queueEarning({ driverId, tripId, shiftId, amountPaise, reason }) {
  await pool.query(
    `INSERT INTO driver_earnings (driver_id, trip_id, shift_id, amount_paise, reason)
     VALUES ($1,$2,$3,$4,$5)`,
    [driverId, tripId, shiftId, amountPaise, reason]
  );
}

/**
 * Runs a payout for one driver: sums all their pending earnings and
 * fires a single Razorpay Payout for the total. Safe to call from a
 * daily cron, or on-demand from an admin action.
 *
 * Idempotency: we generate the idempotency key and reserve it in the
 * DB (unique constraint) BEFORE calling Razorpay. If this function is
 * somehow invoked twice concurrently for the same driver, the second
 * call's INSERT fails and it exits without double-paying.
 */
async function runPayoutForDriver(driverId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the pending earnings so a concurrent run can't grab the same rows.
    const { rows: earnings } = await client.query(
      `SELECT id, amount_paise FROM driver_earnings
       WHERE driver_id = $1 AND status = 'pending'
       FOR UPDATE SKIP LOCKED`,
      [driverId]
    );

    if (earnings.length === 0) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'no pending earnings' };
    }

    const totalPaise = earnings.reduce((sum, e) => sum + Number(e.amount_paise), 0);
    if (totalPaise <= 0) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'nothing owed' };
    }

    const { rows: accountRows } = await client.query(
      `SELECT razorpay_fund_account_id FROM driver_payout_accounts WHERE driver_id = $1 AND verified = true`,
      [driverId]
    );
    if (!accountRows[0]) {
      await client.query('ROLLBACK');
      throw new Error(`driver ${driverId} has no verified payout account`);
    }
    const fundAccountId = accountRows[0].razorpay_fund_account_id;

    // Idempotency key: stable per driver + earning-batch, so a retried
    // request (e.g. cron re-fires after a timeout) reuses the same key
    // and Razorpay itself de-dupes it rather than paying out twice.
    const batchFingerprint = earnings.map((e) => e.id).sort().join(',');
    const idempotencyKey = crypto.createHash('sha256').update(`${driverId}:${batchFingerprint}`).digest('hex');

    const payoutRow = await client.query(
      `INSERT INTO driver_payouts (driver_id, idempotency_key, amount_paise, status)
       VALUES ($1,$2,$3,'initiated')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [driverId, idempotencyKey, totalPaise]
    );

    if (payoutRow.rowCount === 0) {
      // Already reserved by a previous attempt — don't call Razorpay again.
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'payout already initiated for this batch' };
    }
    const payoutId = payoutRow.rows[0].id;

    await client.query(
      `UPDATE driver_earnings SET status = 'queued', payout_id = $1 WHERE id = ANY($2::uuid[])`,
      [payoutId, earnings.map((e) => e.id)]
    );

    await client.query('COMMIT');

    // Call Razorpay AFTER committing the DB reservation — if the API
    // call fails, the payout row stays 'initiated' and a retry can
    // pick it up (see reconcilePendingPayouts below) without ever
    // creating a duplicate transfer, because we reuse the same key.
    try {
      const { data: payout } = await razorpayX.post(
        '/payouts',
        {
          account_number: RAZORPAYX_ACCOUNT_NUMBER,
          fund_account_id: fundAccountId,
          amount: totalPaise,
          currency: 'INR',
          mode: 'IMPS',
          purpose: 'payout',
          queue_if_low_balance: true,
          reference_id: payoutId,
          narration: 'Truck relay driver earnings',
        },
        { headers: { 'X-Payout-Idempotency': idempotencyKey } }
      );

      await pool.query(
        `UPDATE driver_payouts SET razorpay_payout_id = $1, status = $2, updated_at = now() WHERE id = $3`,
        [payout.id, mapPayoutStatus(payout.status), payoutId]
      );

      return { payoutId, razorpayPayoutId: payout.id, amountPaise: totalPaise, status: payout.status };
    } catch (apiErr) {
      // Leave status as 'initiated' — reconcilePendingPayouts will retry
      // using the SAME idempotency key, so Razorpay treats a retry after
      // a network failure as the same request, not a new transfer.
      console.error(`[payoutService] Razorpay payout call failed for driver ${driverId}:`, apiErr.message);
      throw apiErr;
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function mapPayoutStatus(razorpayStatus) {
  // Razorpay payout statuses: queued, pending, processing, processed, reversed, cancelled, rejected
  if (['processed'].includes(razorpayStatus)) return 'processed';
  if (['reversed', 'cancelled', 'rejected'].includes(razorpayStatus)) return 'failed';
  return 'processing';
}

module.exports = { registerDriverPayoutAccount, queueEarning, runPayoutForDriver };
