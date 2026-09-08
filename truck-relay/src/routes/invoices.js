const express = require('express');
const path = require('path');
const pool = require('../db/pool');
const { createInvoice } = require('../services/invoiceService');
const { isEligibleForCredit, issueCreditInvoice, recordCreditPayment } = require('../services/creditBillingService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Generates an invoice for a booking. If the customer is an active
 * B2B credit account with room under their limit, issues a credit
 * invoice (no payment collected now). Otherwise generates a prepaid
 * invoice reflecting whatever's already been paid via Razorpay.
 */
router.post('/bookings/:bookingId', requireAuth, async (req, res) => {
  const { bookingId } = req.params;
  const { billingDetails } = req.body;

  const { rows } = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = rows[0];
  if (!booking) return res.status(404).json({ error: 'booking not found' });

  const creditCheck = await isEligibleForCredit(booking.customer_id, booking.total_amount_paise);

  try {
    if (creditCheck.eligible) {
      const invoice = await issueCreditInvoice({
        bookingId,
        customerId: booking.customer_id,
        totalAmountPaise: booking.total_amount_paise,
        description: `Freight charges for booking ${bookingId}`,
        billingDetails,
      });
      return res.status(201).json({ ...invoice, billingMode: 'credit' });
    }

    // Prepaid path — invoice reflects what's already been captured via
    // the advance/balance Razorpay flow (see routes/payments.js).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invoice = await createInvoice(client, {
        bookingId,
        customerId: booking.customer_id,
        billingMode: 'prepaid',
        lineItems: [{ description: `Freight charges for booking ${bookingId}`, amountPaise: booking.total_amount_paise }],
        billingDetails,
      });
      await client.query('COMMIT');
      res.status(201).json({ ...invoice, billingMode: 'prepaid' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:invoiceId', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM invoices WHERE id = $1`, [req.params.invoiceId]);
  if (!rows[0]) return res.status(404).json({ error: 'invoice not found' });
  res.json(rows[0]);
});

router.get('/:invoiceId/pdf', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT pdf_path, invoice_number FROM invoices WHERE id = $1`, [req.params.invoiceId]);
  if (!rows[0]?.pdf_path) return res.status(404).json({ error: 'invoice PDF not found' });
  res.download(path.resolve(rows[0].pdf_path), `${rows[0].invoice_number}.pdf`);
});

// Admin marks a credit invoice as paid after reconciling an offline payment.
router.post('/:invoiceId/mark-paid', requireAuth, requireRole('admin'), async (req, res) => {
  const { amountPaise } = req.body;
  try {
    const result = await recordCreditPayment(req.params.invoiceId, amountPaise);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
