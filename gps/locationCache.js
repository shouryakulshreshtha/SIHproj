/**
 * locationCache.js
 * ------------------------------------------------------------------
 * Holds the "best currently known" location per trip, and resolves
 * it from multiple sources with a fallback chain:
 *
 *   1. gps          — device GPS ping (most accurate, preferred)
 *   2. network       — wifi/cell-tower based ping from the driver app
 *   3. last_known    — most recent good reading, if nothing fresh has
 *                      arrived within STALE_MS
 *   4. ip_geo        — coarse IP-based geolocation, last resort, only
 *                      used if the driver app has gone completely
 *                      silent (e.g. app killed, no signal)
 *
 * In production, swap the in-memory Map for Redis (see notes below)
 * so this works across multiple server instances.
 * ------------------------------------------------------------------
 */

const axios = require('axios');
const pool = require('../db/pool');

// How long a reading is considered "fresh" before we start falling back.
const STALE_MS = 45 * 1000;       // 45s — tune to your ping interval
const DEAD_MS = 5 * 60 * 1000;    // 5min — beyond this, try IP geolocation

// source priority — lower number = more trusted, used to avoid an
// old-but-precise GPS reading being clobbered by a fresher-but-worse
// network reading within the same short window.
const SOURCE_PRIORITY = { gps: 1, network: 2, last_known: 3, ip_geo: 4 };

/**
 * In-memory cache: Map<tripId, LocationRecord>
 * For multi-instance deployments, replace with Redis:
 *   await redis.hset(`trip:${tripId}:loc`, record)
 *   await redis.expire(`trip:${tripId}:loc`, 3600)
 */
const cache = new Map();

/**
 * Called whenever a location ping arrives (from WebSocket or REST poll).
 */
async function recordLocation(tripId, {
  lat, lng, accuracyM, speedKmh, headingDeg, source, recordedAt,
}) {
  const now = Date.now();
  const recordedTs = recordedAt ? new Date(recordedAt).getTime() : now;
  const existing = cache.get(tripId);

  const candidate = {
    lat, lng,
    accuracyM: accuracyM ?? null,
    speedKmh: speedKmh ?? null,
    headingDeg: headingDeg ?? null,
    source,
    recordedAt: recordedTs,
    updatedAt: now,
  };

  // Accept the new reading unless we already have something fresher
  // AND more trustworthy (avoids a stale-but-late GPS packet from
  // overwriting a newer network reading it raced with, and vice versa).
  if (existing) {
    const existingIsFresh = now - existing.updatedAt < STALE_MS;
    const candidateLessTrusted =
      SOURCE_PRIORITY[candidate.source] > SOURCE_PRIORITY[existing.source];
    if (existingIsFresh && candidateLessTrusted && candidate.recordedAt <= existing.recordedAt) {
      return existing; // ignore worse, non-newer reading
    }
  }

  cache.set(tripId, candidate);

  // Fire-and-forget persistence — don't block the hot path on DB writes.
  persistLocation(tripId, candidate).catch((err) =>
    console.error(`[locationCache] persist failed for trip ${tripId}:`, err.message)
  );

  return candidate;
}

async function persistLocation(tripId, loc) {
  await pool.query(
    `INSERT INTO trip_locations (trip_id, lat, lng, accuracy_m, speed_kmh, heading_deg, source, recorded_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0), now())
     ON CONFLICT (trip_id) DO UPDATE SET
       lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy_m = EXCLUDED.accuracy_m,
       speed_kmh = EXCLUDED.speed_kmh, heading_deg = EXCLUDED.heading_deg,
       source = EXCLUDED.source, recorded_at = EXCLUDED.recorded_at, updated_at = now()`,
    [tripId, loc.lat, loc.lng, loc.accuracyM, loc.speedKmh, loc.headingDeg, loc.source, loc.recordedAt]
  );

  await pool.query(
    `INSERT INTO trip_location_history (trip_id, lat, lng, accuracy_m, source, recorded_at)
     VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0))`,
    [tripId, loc.lat, loc.lng, loc.accuracyM, loc.source, loc.recordedAt]
  );
}

/**
 * Resolves the best available location for a trip, walking the
 * fallback chain if the live cache is empty or stale.
 */
async function resolveLocation(tripId) {
  const now = Date.now();
  const live = cache.get(tripId);

  if (live && now - live.updatedAt < STALE_MS) {
    return live; // fresh gps/network reading — best case
  }

  if (live && now - live.updatedAt < DEAD_MS) {
    // Not fresh, but not dead either — serve last known with a flag
    // so the frontend can show "last seen 2 min ago" instead of live dot.
    return { ...live, source: 'last_known', stale: true };
  }

  // Nothing live at all, or it's gone dark for 5+ minutes.
  // Try DB in case another instance has it (multi-instance safety net).
  const dbRow = await pool.query(
    `SELECT lat, lng, accuracy_m as "accuracyM", source, recorded_at as "recordedAt"
     FROM trip_locations WHERE trip_id = $1`,
    [tripId]
  );
  if (dbRow.rows[0] && now - new Date(dbRow.rows[0].recordedAt).getTime() < DEAD_MS) {
    return { ...dbRow.rows[0], source: 'last_known', stale: true };
  }

  // Last resort: coarse IP-based location. Only useful for a rough
  // "still in this city/region" signal — never treat as precise.
  const ipLocation = await resolveIpGeolocation(tripId);
  if (ipLocation) return { ...ipLocation, source: 'ip_geo', stale: true };

  return null; // truly no signal available
}

/**
 * Looks up an approximate location via the driver device's last-known
 * public IP (captured at connection time — see websocket handler).
 * Swap the provider below for whichever IP geolocation service you use.
 */
async function resolveIpGeolocation(tripId) {
  const lastIp = ipByTrip.get(tripId);
  if (!lastIp) return null;

  try {
    // Example using ipapi.co — replace with your provider/API key.
    const { data } = await axios.get(`https://ipapi.co/${lastIp}/json/`, { timeout: 3000 });
    if (!data?.latitude) return null;
    return {
      lat: data.latitude,
      lng: data.longitude,
      accuracyM: 50000, // IP geolocation is city-level at best — be honest about it
      recordedAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (err) {
    console.error(`[locationCache] IP geolocation failed for trip ${tripId}:`, err.message);
    return null;
  }
}

// Track last-seen IP per trip (set from the WS connection handshake).
const ipByTrip = new Map();
function recordIp(tripId, ip) {
  if (ip) ipByTrip.set(tripId, ip);
}

module.exports = { recordLocation, resolveLocation, recordIp };
