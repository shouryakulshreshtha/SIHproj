/**
 * app.js — wires everything together.
 * NOTE the webhook route is mounted BEFORE express.json(), because it
 * needs the raw request body for signature verification (see routes/webhooks.js).
 */

require('dotenv').config();
const express = require('express');
const http = require('http');

const webhookRoutes = require('./routes/webhooks');           // uses express.raw() internally
const payoutWebhookRoutes = require('./routes/payoutWebhooks'); // also uses express.raw()
const trackingRoutes = require('./routes/tracking');
const paymentRoutes = require('./routes/payments');
const payoutRoutes = require('./routes/payouts');
const ratingRoutes = require('./routes/ratings');
const cancellationRoutes = require('./routes/cancellations');
const detentionRoutes = require('./routes/detention');
const notificationRoutes = require('./routes/notifications');
const invoiceRoutes = require('./routes/invoices');
const { initLocationTracking } = require('./websocket/locationTracking');

const app = express();
const httpServer = http.createServer(app);

// Webhook routes FIRST, with their own raw-body parsing — must not go
// through express.json() or signature verification will fail.
app.use('/api/payments/webhooks', webhookRoutes);
app.use('/api/payouts/webhooks', payoutWebhookRoutes);

// Everything else uses normal JSON parsing.
app.use(express.json());

app.use('/api/tracking', trackingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/bookings', cancellationRoutes);
app.use('/api/trips', detentionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/invoices', invoiceRoutes);

// Set up Socket.io and make it available to REST routes (used in
// routes/tracking.js to also push polling updates to WS subscribers).
const io = initLocationTracking(httpServer);
app.set('io', io);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server listening on :${PORT}`));

module.exports = app;
