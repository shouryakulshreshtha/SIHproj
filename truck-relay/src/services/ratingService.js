/**
 * ratingService.js
 * Only drivers and customers who were actually on the same trip can
 * rate each other, and only once per trip (enforced by the UNIQUE
 * constraint on ratings(trip_id, rater_id, ratee_id)).
 */

const pool = require('../db/pool');

async function submitRating({ tripId, bookingId, raterRole, raterId, rateeId, stars, comment }) {
  if (stars < 1 || stars > 5) throw new Error('stars must be between 1 and 5');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO ratings (trip_id, booking_id, rater_role, rater_id, ratee_id, stars, comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (trip_id, rater_id, ratee_id) DO NOTHING
       RETURNING id`,
      [tripId, bookingId, raterRole, raterId, rateeId, stars, comment]
    );

    if (insertResult.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('already rated this person for this trip');
    }

    // Only maintain the aggregate for driver ratings — customers being
    // rated is optional/internal and doesn't need a public summary.
    if (raterRole === 'customer') {
      await client.query(
        `INSERT INTO driver_rating_summary (driver_id, avg_rating, ratings_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (driver_id) DO UPDATE SET
           avg_rating = (driver_rating_summary.avg_rating * driver_rating_summary.ratings_count + $2)
                        / (driver_rating_summary.ratings_count + 1),
           ratings_count = driver_rating_summary.ratings_count + 1`,
        [rateeId, stars]
      );
    }

    await client.query('COMMIT');
    return insertResult.rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function getDriverRatingSummary(driverId) {
  const { rows } = await pool.query(
    `SELECT avg_rating as "avgRating", ratings_count as "ratingsCount" FROM driver_rating_summary WHERE driver_id = $1`,
    [driverId]
  );
  return rows[0] || { avgRating: 0, ratingsCount: 0 };
}

module.exports = { submitRating, getDriverRatingSummary };
