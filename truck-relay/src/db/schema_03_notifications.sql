-- ============================================================
-- Migration 03: Notifications (push / SMS / WhatsApp)
-- ============================================================

-- Push notification device tokens — a user can have multiple
-- (phone + tablet, or reinstalled app generating a new token).
CREATE TABLE IF NOT EXISTS device_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  platform    TEXT NOT NULL,   -- 'ios' | 'android' | 'web'
  token       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

-- Audit log of every notification attempt, across all channels.
-- Useful for debugging "customer says they never got the SMS" and
-- for basic retry bookkeeping.
CREATE TABLE IF NOT EXISTS notification_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_type      TEXT NOT NULL,   -- 'customer' | 'driver'
  recipient_id        UUID NOT NULL,
  channel             TEXT NOT NULL,   -- 'push' | 'sms' | 'whatsapp'
  template_key        TEXT NOT NULL,   -- e.g. 'booking_confirmed', 'driver_assigned'
  message             TEXT,
  status              TEXT NOT NULL DEFAULT 'queued', -- queued | sent | failed
  provider_message_id TEXT,
  error               TEXT,
  attempt             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_log_recipient
  ON notification_log (recipient_type, recipient_id, created_at DESC);
