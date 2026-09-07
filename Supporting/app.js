/**
 * app.js — wires everything together.
 * NOTE the webhook route is mounted BEFORE express.json(), because it
 * needs the raw request body for signature verification (see routes/webhooks.js).
 */

require('dotenv').config();
const express = require('express');
const http = require('http');

const webhookRoutes = require('./routes/webhooks');      // uses express.raw() internally
const trackingRoutes = require('./routes/tracking');
const paymentRoutes = require('./routes/payments');
const { initLocationTracking } = require('./websocket/locationTracking');

const app = express();
const httpServer = http.createServer(app);

// Webhook route FIRST, with its own raw-body parsing — must not go
// through express.json() or signature verification will fail.
app.use('/api/payments/webhooks', webhookRoutes);

// Everything else uses normal JSON parsing.
app.use(express.json());

app.use('/api/tracking', trackingRoutes);
app.use('/api/payments', paymentRoutes);

// Set up Socket.io and make it available to REST routes (used in
// routes/tracking.js to also push polling updates to WS subscribers).
const io = initLocationTracking(httpServer);
app.set('io', io);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server listening on :${PORT}`));

module.exports = app;
