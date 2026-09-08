/**
 * detentionService.js
 * ------------------------------------------------------------------
 * Detention = time the truck spends waiting at a pickup/delivery
 * point beyond an agreed free window (e.g. 2 hours for loading).
 * Time beyond that is billed to the customer AND queued as extra
 * earning for the driver — they're the one who actually waited.
 * ------------------------------------------------------------------
 */

const pool = require('../db/pool');
const { queueEarning } = require('./payoutService');

const DEFAULT_FREE_MINUTES = 120;
const DEFAULT_RATE_PAISE_PER_HOUR = 20000; // ₹200/hr

async function recordArrival({ tripId, bookingId, stopType, freeMinutes, ratePaisePerHour }) {
  const { rows } = await pool.query(
    `INSERT INTO stop_events (trip_id, booking_id, stop_type, arrived_at, free_minutes, detention_rate_paise_per_hour)
     VALUES ($1,$2,$3, now(), $4, $5)
     RETURNING id, arrived_at`,
    [tripId, bookingId, stopType, freeMinutes ?? DEFAULT_FREE_MINUTES, ratePaisePerHour ?? DEFAULT_RATE_PAISE_PER_HOUR]
  );
  return rows[0];
}

/**
 * Marks departure and, if the stay exceeded the free window, computes
 * and records the detention charge — billed to the booking's balance,
 * and queued as a bonus earning for the currently-active driver
 * (so relay handoffs mid-wait still credit whoever was actually there).
 */
async function recordDeparture({ stopEventId, activeDriverId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM stop_events WHERE id = $1 FOR UPDATE`,
      [stopEventId]
    );
    const stop = rows[0];
    if (!stop) throw new Error('stop event not found');
    if (!stop.arrived_at) throw new Error('arrival was never recorded for this stop');
    if (stop.departed_at) throw new Error('departure already recorded');

    const departedAt = new Date();
    const waitedMinutes = Math.floor((departedAt - new Date(stop.arrived_at)) / 60000);
    const detentionMinutes = Math.max(0, waitedMinutes - stop.free_minutes);
    const detentionHoursRoundedUp = Math.ceil(detentionMinutes / 60); // billed in full-hour blocks — adjust if you prefer per-minute
    const detentionChargePaise = detentionHoursRoundedUp * Number(stop.detention_rate_paise_per_hour);

    await client.query(
      `UPDATE stop_events SET
         departed_at = $1,
         detention_minutes = $2,
         detention_charge_paise = $3
       WHERE id = $4`,
      [departedAt, detentionMinutes, detentionChargePaise, stopEventId]
    );

    if (detentionChargePaise > 0) {
      // Add to what the customer owes.
      if (stop.booking_id) {
        await client.query(
          `UPDATE bookings SET
             balance_amount_paise = balance_amount_paise + $1,
             total_amount_paise = total_amount_paise + $1
           WHERE id = $2`,
          [detentionChargePaise, stop.booking_id]
        );
      }

      await client.query('COMMIT');

      // Queue the driver's cut of the detention charge as earning.
      // (Fire after commit since it writes to a different concern —
      // payouts — and shouldn't roll back the stop-event record if
      // this secondary step fails; log and let reconciliation catch it.)
      if (activeDriverId) {
        await queueEarning({
          driverId: activeDriverId,
          tripId: stop.trip_id,
          amountPaise: detentionChargePaise,
          reason: 'detention_bonus',
        }).catch((err) => console.error('[detentionService] failed to queue driver earning:', err.message));
      }
    } else {
      await client.query('COMMIT');
    }

    return { stopEventId, waitedMinutes, detentionMinutes, detentionChargePaise };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordArrival, recordDeparture };
