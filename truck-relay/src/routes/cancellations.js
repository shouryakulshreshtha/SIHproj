const express = require('express');
const { cancelBooking } = require('../services/cancellationService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/:bookingId/cancel', requireAuth, async (req, res) => {
  try {
    const result = await cancelBooking(req.params.bookingId, { cancelledByRole: req.user.role });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
