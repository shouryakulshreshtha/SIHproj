/**
 * cancellationPolicy.js
 * ------------------------------------------------------------------
 * Maps a booking's current stage to the cancellation fee charged.
 * Fees are a PERCENTAGE of the booking's total_amount_paise, except
 * 'booked' which is free (no truck/driver committed yet).
 *
 * Adjust freely — this is a config, not logic. If you need flat fees
 * instead of percentages for some stages, add a `flatPaise` field and
 * branch on it in cancellationService.js.
 * ------------------------------------------------------------------
 */

const CANCELLATION_STAGES = {
  booked: {
    // No driver assigned yet — free to cancel.
    feePercent: 0,
    label: 'Booked, no driver assigned',
  },
  driver_assigned: {
    // A driver/truck has been allocated but hasn't started moving.
    feePercent: 10,
    label: 'Driver assigned',
  },
  en_route_pickup: {
    // Truck is already on the way to the pickup point.
    feePercent: 25,
    label: 'Truck en route to pickup',
  },
  loaded_in_transit: {
    // Goods are loaded and the truck is moving — cancelling now means
    // real cost was already incurred (fuel, driver time, possibly a
    // relay handoff already scheduled).
    feePercent: 75,
    label: 'Loaded and in transit',
  },
};

function getStagePolicy(stage) {
  const policy = CANCELLATION_STAGES[stage];
  if (!policy) throw new Error(`unknown cancellation stage: ${stage}`);
  return policy;
}

module.exports = { CANCELLATION_STAGES, getStagePolicy };
