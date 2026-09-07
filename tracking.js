/**
 * routes/tracking.js — REST fallback for clients that can't hold a
 * WebSocket open (flaky networks, in-app webviews, some corporate
 * proxies). Reads/writes the SAME locationCache as the WS handler,
 * so both transports stay consistent.
 *
 *   GET  /api/tracking/:tripId/location      -> poll for current location
 *   POST /api/tracking/:tripId/location      -> driver app posts a ping
 */

const express = require('express');
const { recordLocation, resolveLocation, recordIp } = require('../services/locationCache');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Recommended poll interval for clients using this fallback: 10-15s.
router.get('/:tripId/location', requireAuth, async (req, res) => {
  const { tripId } = req.params;
  const location = await resolveLocation(tripId);
  if (!location) {
    return res.status(404).json({ error: 'no location available yet' });
  }
  res.json({ tripId, ...location });
});

router.post('/:tripId/location', requireAuth, requireRole('driver'), async (req, res) => {
  const { tripId } = req.params;
  const { lat, lng, accuracy, speed, heading, source = 'network', recordedAt } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat/lng required as numbers' });
  }

  recordIp(tripId, req.ip);
  const record = await recordLocation(tripId, {
    lat, lng, accuracyM: accuracy, speedKmh: speed, headingDeg: heading, source, recordedAt,
  });

  // Also push to any WebSocket-connected subscribers so both transports
  // see the update immediately, not just the next poll cycle.
  const io = req.app.get('io');
  if (io) io.of('/tracking').to(`trip:${tripId}`).emit('location:update', record);

  res.status(201).json({ tripId, ...record });
});

module.exports = router;
