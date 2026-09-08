/**
 * creditBillingService.js
 * ------------------------------------------------------------------
 * Decides HOW a booking gets billed:
 *   - customer has a b2b_customers row with room under their credit
 *     limit  -> issue a credit invoice (due in N days, no payment
 *     collected up front)
 *   - otherwise -> normal prepaid flow (advance/balance via Razorpay,
 *     see routes/payments.js) — this service isn't involved at all.
 *
 * Credit invoices still get an `invoices` row and PDF via
 * invoiceService.js; they just don't have a Razorpay order attached
 * until the customer actually pays (recordCreditPayment below).
 * ------------------------------------------------------------------
 */

const pool = require('../db/pool');
const { createInvoice } = require('./invoiceService');
const { notify } = require('./notificationService');

async function isEligibleForCredit(customerId, amountPaise) {
  const { rows } = await pool.query(
    `SELECT credit_limit_paise, outstanding_paise, status FROM b2b_customers WHERE customer_id = $1`,
    [customerId]
  );
  const account = rows[0];
  if (!account || account.status !== 'active') return { eligible: false, reason: 'not a B2B credit customer' };

  const available = Number(account.credit_limit_paise) - Number(account.outstanding_paise);
  if (amountPaise > available) {
    return { eligible: false, reason: `exceeds available credit (₹${(available / 100).toFixed(2)} left)` };
  }
  return { eligible: true };
}

/**
 * Issues a credit invoice for a booking and increments the customer's
 * outstanding balance. Call this instead of createBookingWithAdvanceOrder
 * (from razorpayService.js) when isEligibleForCredit() returns true.
 */
async function issueCreditInvoice({ bookingId, customerId, totalAmountPaise, description, billingDetails }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-check + reserve credit atomically under the row lock, so two
    // concurrent bookings can't both slip in under the same limit.
    const { rows } = await client.query(
      `SELECT credit_limit_paise, outstanding_paise, credit_terms_days, status
       FROM b2b_customers WHERE customer_id = $1 FOR UPDATE`,
      [customerId]
    );
    const account = rows[0];
    if (!account || account.status !== 'active') throw new Error('customer is not an active B2B credit account');

    const available = Number(account.credit_limit_paise) - Number(account.outstanding_paise);
    if (totalAmountPaise > available) {
      throw new Error(`exceeds available credit (₹${(available / 100).toFixed(2)} left)`);
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + account.credit_terms_days);

    const invoice = await createInvoice(client, {
      bookingId,
      customerId,
      billingMode: 'credit',
      dueDate: dueDate.toISOString().slice(0, 10),
      lineItems: [{ description: description || 'Freight charges', amountPaise: totalAmountPaise }],
      billingDetails,
    });

    await client.query(
      `UPDATE b2b_customers SET outstanding_paise = outstanding_paise + $1 WHERE customer_id = $2`,
      [totalAmountPaise, customerId]
    );

    await client.query(
      `UPDATE bookings SET status = 'invoiced_on_credit' WHERE id = $1`,
      [bookingId]
    );

    await client.query('COMMIT');

    await notify({
      recipientType: 'customer',
      recipientId: customerId,
      channels: ['push'],
      templateKey: 'invoice_issued',
      data: { invoiceNumber: invoice.invoiceNumber, totalPaise: invoice.totalPaise, dueDate: dueDate.toDateString() },
    }).catch((err) => console.error('[creditBillingService] notify failed:', err.message));

    return invoice;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Records a (typically offline — bank transfer, cheque) payment
 * against a credit invoice. Admin-triggered after reconciling bank
 * statements; there's no Razorpay webhook for this path since the
 * money doesn't move through Razorpay for credit customers.
 */
async function recordCreditPayment(invoiceId, amountPaise) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
    const invoice = rows[0];
    if (!invoice) throw new Error('invoice not found');
    if (invoice.billing_mode !== 'credit') throw new Error('not a credit invoice');
    if (invoice.status === 'paid') throw new Error('invoice already marked paid');

    if (amountPaise < Number(invoice.total_paise)) {
      throw new Error('partial payments not supported by this endpoint — record the full amount or extend for partial tracking');
    }

    await client.query(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [invoiceId]);
    await client.query(
      `UPDATE b2b_customers SET outstanding_paise = GREATEST(0, outstanding_paise - $1) WHERE customer_id = $2`,
      [invoice.total_paise, invoice.customer_id]
    );

    await client.query('COMMIT');
    return { invoiceId, status: 'paid' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { isEligibleForCredit, issueCreditInvoice, recordCreditPayment };
