/**
 * locationTracking.js — Live GPS over WebSocket (Socket.io)
 * ------------------------------------------------------------------
 * Namespace: /tracking
 *
 * Driver app:
 *   socket.emit('driver:join', { tripId, driverId, authToken })
 *   socket.emit('location:update', { lat, lng, accuracy, speed, heading, source, recordedAt })
 *
 * Customer / admin app:
 *   socket.emit('trip:subscribe', { tripId, authToken })
 *   socket.on('location:current', (loc) => ...)   // initial snapshot
 *   socket.on('location:update', (loc) => ...)    // live pushes
 *   socket.on('driver:offline', () => ...)        // no ping in DEAD_MS
 *
 * If a client's WebSocket can't connect (corporate proxy, old app
 * version, etc.) it should fall back to the REST polling endpoint in
 * routes/tracking.js — same underlying locationCache, so both stay
 * in sync automatically.
 * ------------------------------------------------------------------
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { recordLocation, resolveLocation, recordIp } = require('../services/locationCache');

const JWT_SECRET = process.env.JWT_SECRET;
const HEARTBEAT_CHECK_MS = 30 * 1000;
const DRIVER_OFFLINE_AFTER_MS = 60 * 1000;

function initLocationTracking(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || '*' },
    path: '/socket.io',
  });

  const tracking = io.of('/tracking');

  // trip room = `trip:${tripId}` — driver publishes here, customers/admin subscribe
  const lastPingAt = new Map(); // tripId -> timestamp, for offline detection

  tracking.use((socket, next) => {
    // Basic auth on connect — reject anything without a valid token.
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      socket.user = jwt.verify(token, JWT_SECRET); // { id, role: 'driver'|'customer'|'admin' }
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  tracking.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    socket.on('driver:join', ({ tripId }) => {
      if (socket.user.role !== 'driver') return socket.emit('error', 'not a driver');
      socket.join(`trip:${tripId}`);
      socket.tripId = tripId;
      recordIp(tripId, clientIp);
    });

    socket.on('trip:subscribe', async ({ tripId }) => {
      // customers/admin can only subscribe, never publish updates
      socket.join(`trip:${tripId}`);
      const current = await resolveLocation(tripId);
      if (current) socket.emit('location:current', current);
    });

    socket.on('location:update', async (payload) => {
      if (socket.user.role !== 'driver' || !socket.tripId) return;

      const {
        lat, lng, accuracy, speed, heading, source = 'gps', recordedAt,
      } = payload;

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return socket.emit('error', 'invalid location payload');
      }

      const tripId = socket.tripId;
      lastPingAt.set(tripId, Date.now());

      const record = await recordLocation(tripId, {
        lat, lng,
        accuracyM: accuracy,
        speedKmh: speed,
        headingDeg: heading,
        source,
        recordedAt,
      });

      // Broadcast to everyone subscribed to this trip (customer + admin dashboards).
      tracking.to(`trip:${tripId}`).emit('location:update', record);
    });

    socket.on('disconnect', () => {
      // Don't immediately mark offline — driver app may reconnect within
      // seconds (tunnel, network blip). The heartbeat sweep below handles
      // genuine "gone dark" cases.
    });
  });

  // Periodic sweep: tell subscribers if a driver has stopped sending pings,
  // so the frontend can switch from "live" to "last seen" state.
  setInterval(() => {
    const now = Date.now();
    for (const [tripId, last] of lastPingAt.entries()) {
      if (now - last > DRIVER_OFFLINE_AFTER_MS) {
        tracking.to(`trip:${tripId}`).emit('driver:offline', { tripId, lastSeenAt: last });
      }
    }
  }, HEARTBEAT_CHECK_MS);

  return io;
}

module.exports = { initLocationTracking };
