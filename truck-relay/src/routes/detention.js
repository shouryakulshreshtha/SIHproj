const express = require('express');
const { recordArrival, recordDeparture } = require('../services/detentionService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// stopType: 'pickup' | 'delivery'
router.post('/:tripId/stops/:stopType/arrive', requireAuth, requireRole('driver'), async (req, res) => {
  const { tripId, stopType } = req.params;
  const { bookingId, freeMinutes, ratePaisePerHour } = req.body;

  const result = await recordArrival({ tripId, bookingId, stopType, freeMinutes, ratePaisePerHour });
  res.status(201).json(result);
});

router.post('/stops/:stopEventId/depart', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const result = await recordDeparture({ stopEventId: req.params.stopEventId, activeDriverId: req.user.id });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
