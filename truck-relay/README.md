# Truck Relay — Tracking + Payments Backend

Two features, ready to drop into an Express backend:

## 1. Live GPS tracking
- **WebSocket** (`src/websocket/locationTracking.js`): Socket.io namespace `/tracking`. Drivers push `location:update`; subscribers (customer app, admin dashboard) get pushed live updates in the `trip:{tripId}` room.
- **REST polling fallback** (`src/routes/tracking.js`): `GET /api/tracking/:tripId/location` and `POST /api/tracking/:tripId/location`, for clients that can't hold a WebSocket open. Both transports read/write the same cache, so they stay in sync.
- **Multi-source fallback** (`src/services/locationCache.js`): resolves the best available location through `gps → network → last_known → ip_geo`, based on how stale the most recent reading is. Swap `ipapi.co` for whatever IP-geolocation provider you use.

### Relay-specific note
`trip_shifts` in the schema ties each 10-hour driver shift to the trip, so location history stays attributed to the right driver even as the truck gets handed off mid-journey. The location pipeline itself doesn't care which driver is active — it's keyed by `tripId`, not `driverId`.

## 2. Razorpay payments (advance/balance split)
- **Order creation** (`src/services/razorpayService.js`): `createBookingWithAdvanceOrder` splits the total into an advance % (`ADVANCE_PERCENT` env var) and creates the Razorpay order for that leg. `createBalanceOrder` creates the second order once the balance is due.
- **Client-side verification** (`src/routes/payments.js` — `POST /verify`): quick UI feedback only, not the source of truth.
- **Webhook (source of truth)** (`src/routes/webhooks.js`): `POST /api/payments/webhooks/razorpay`. Verifies the HMAC signature, then uses a `processed_webhook_events` table with a `PRIMARY KEY` on `event_id` to make processing idempotent — a duplicate delivery is a guaranteed no-op, and the dedup-insert + business-logic update happen in one DB transaction.

## 3. Driver payouts (Razorpay Payouts / RazorpayX, no wallet)
- **No internal wallet**: driver earnings live only as rows in `driver_earnings` (status `pending`). Nothing is "held" — a driver's balance is just `SUM(pending earnings)`, computed live (`GET /api/payouts/drivers/:id/pending`).
- **`services/payoutService.js`**: `queueEarning()` records money owed (call this at end of a shift, or from the detention service). `runPayoutForDriver()` sums pending earnings and fires one real bank transfer via RazorpayX, using a SHA-256 idempotency key derived from the exact batch of earning rows — a retried call reuses the same key, so Razorpay itself de-dupes it rather than paying out twice.
- **`routes/payoutWebhooks.js`**: confirms `payout.processed` / `payout.failed` / `payout.reversed` from Razorpay, using the same transactional dedup pattern as the payments webhook. On failure, earnings are reset to `pending` so the next run retries them automatically.
- Requires a RazorpayX current account — separate credentials (`RAZORPAYX_*`) from standard Payments.

## 4. Ratings
- **`services/ratingService.js`**: one rating per person per trip (DB-enforced). Maintains a running average in `driver_rating_summary` via a single UPDATE, instead of recomputing `AVG()` over the whole table on every read.
- **`routes/ratings.js`**: `POST /api/ratings` to submit, `GET /api/ratings/drivers/:id/summary` for the public aggregate.

## 5. Cancellations (stage-based fees)
- **`constants/cancellationPolicy.js`**: the fee table — tune percentages per stage here. Stages: `booked` (free) → `driver_assigned` (10%) → `en_route_pickup` (25%) → `loaded_in_transit` (75%).
- **`services/cancellationService.js`**: maps the booking's current status to a stage, computes the fee, and settles it against the advance already paid — auto-refunding the difference via `razorpay.payments.refund`, or flagging an outstanding amount if the fee exceeds what was collected (only possible at high-fee stages with a low advance %).

## 6. Detention charges
- **`services/detentionService.js`**: `recordArrival()` / `recordDeparture()` at a pickup or delivery stop. Time beyond the free window (default 2hrs, configurable per stop) is billed to the customer's booking balance AND queued as a bonus earning for whichever driver was actively on shift — important for the relay model, since the driver waiting at a stop might hand off mid-wait.

## Setup
```bash
npm install
cp .env.example .env   # fill in your real values
psql $DATABASE_URL -f src/db/schema.sql
psql $DATABASE_URL -f src/db/schema_02_payouts_ratings_cancellations_detention.sql
npm run dev
```

## Razorpay dashboard setup
1. Create a webhook pointing to `https://yourdomain.com/api/payments/webhooks/razorpay`.
2. Subscribe to at least `payment.captured` and `payment.failed`.
3. Copy the webhook secret into `RAZORPAY_WEBHOOK_SECRET`.

## RazorpayX dashboard setup (for payouts)
1. Activate a RazorpayX current account and note its account number into `RAZORPAYX_ACCOUNT_NUMBER`.
2. Create a separate webhook pointing to `https://yourdomain.com/api/payouts/webhooks/razorpay`, subscribed to `payout.processed`, `payout.failed`, `payout.reversed`.
3. Copy that webhook's secret into `RAZORPAYX_WEBHOOK_SECRET`.

## Things to adapt before production
- Swap the in-memory `locationCache` Map for Redis if you run more than one server instance (notes are in the file).
- The `payments` amounts are stored in **paise** (integer) — never use floats for money.
- `ADVANCE_PERCENT` is a flat 30% here; if your pricing needs per-booking custom splits, pass the split explicitly instead of computing it from one env var.
- Add rate limiting to the location POST endpoint — a misbehaving driver app hammering it is a real scenario.
