const express = require('express');
const { notify, registerDeviceToken } = require('../services/notificationService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/device-tokens', requireAuth, async (req, res) => {
  const { platform, token } = req.body;
  if (!platform || !token) return res.status(400).json({ error: 'platform and token required' });
  await registerDeviceToken(req.user.id, platform, token);
  res.status(201).json({ registered: true });
});

// Handy for verifying gateway credentials/templates without triggering real app flows.
router.post('/test-send', requireAuth, requireRole('admin'), async (req, res) => {
  const { recipientType, recipientId, channels, templateKey, data, phone } = req.body;
  const results = await notify({ recipientType, recipientId, channels, templateKey, data, phone });
  res.json({ results });
});

module.exports = router;
