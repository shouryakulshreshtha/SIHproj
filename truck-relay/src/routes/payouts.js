/**
 * routes/payouts.js
 *   POST /api/payouts/accounts          -> driver registers bank/UPI details
 *   POST /api/payouts/drivers/:id/run   -> trigger a payout (admin or cron)
 *   GET  /api/payouts/drivers/:id/pending -> what's currently owed (no wallet — just a live sum)
 */

const express = require('express');
const { registerDriverPayoutAccount, runPayoutForDriver } = require('../services/payoutService');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/accounts', requireAuth, requireRole('driver'), async (req, res) => {
  const { name, email, contactNumber, bankAccount, vpa } = req.body;
  if (!bankAccount && !vpa) {
    return res.status(400).json({ error: 'provide either bankAccount or vpa' });
  }

  const fundAccount = await registerDriverPayoutAccount(req.user.id, {
    name, email, contactNumber, bankAccount, vpa,
  });

  res.status(201).json({ fundAccountId: fundAccount.id, status: 'pending_verification' });
});

// Restrict to admin/cron caller — never let a driver trigger their own payout on demand
// unless that's an intentional product decision (instant payout, usually a paid feature).
router.post('/drivers/:driverId/run', requireAuth, requireRole('admin'), async (req, res) => {
  const { driverId } = req.params;
  try {
    const result = await runPayoutForDriver(driverId);
    res.json(result);
  } catch (err) {
    console.error('[payouts] run failed:', err.message);
    res.status(500).json({ error: 'payout failed', detail: err.message });
  }
});

router.get('/drivers/:driverId/pending', requireAuth, async (req, res) => {
  const { driverId } = req.params;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount_paise), 0) as "pendingPaise", COUNT(*) as "pendingCount"
     FROM driver_earnings WHERE driver_id = $1 AND status = 'pending'`,
    [driverId]
  );
  res.json(rows[0]);
});

module.exports = router;
