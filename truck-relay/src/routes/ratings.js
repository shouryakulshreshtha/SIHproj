const express = require('express');
const { submitRating, getDriverRatingSummary } = require('../services/ratingService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const { tripId, bookingId, rateeId, stars, comment } = req.body;
  try {
    const ratingId = await submitRating({
      tripId,
      bookingId,
      raterRole: req.user.role,
      raterId: req.user.id,
      rateeId,
      stars,
      comment,
    });
    res.status(201).json({ ratingId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/drivers/:driverId/summary', async (req, res) => {
  const summary = await getDriverRatingSummary(req.params.driverId);
  res.json(summary);
});

module.exports = router;
