-- ============================================================
-- Migration 04: Invoicing + B2B credit billing
-- ============================================================

-- A B2B customer's credit profile. Regular (prepaid) customers don't
-- need a row here at all — absence of a row means "not on credit terms".
CREATE TABLE IF NOT EXISTS b2b_customers (
  customer_id         UUID PRIMARY KEY,
  company_name        TEXT NOT NULL,
  gstin                TEXT,
  billing_email        TEXT,
  credit_limit_paise   BIGINT NOT NULL DEFAULT 0,
  credit_terms_days    INTEGER NOT NULL DEFAULT 30,
  outstanding_paise    BIGINT NOT NULL DEFAULT 0,  -- sum of unpaid credit invoices
  status               TEXT NOT NULL DEFAULT 'active', -- active | suspended
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Yearly sequence used to generate human-readable invoice numbers
-- like INV-2026-000042.
CREATE TABLE IF NOT EXISTS invoice_sequence (
  year        INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT UNIQUE NOT NULL,
  booking_id      UUID REFERENCES bookings(id),
  customer_id     UUID NOT NULL,
  billing_mode    TEXT NOT NULL,              -- 'prepaid' | 'credit'
  subtotal_paise  BIGINT NOT NULL,
  tax_paise       BIGINT NOT NULL DEFAULT 0,
  total_paise     BIGINT NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date        DATE,                       -- only set for billing_mode = 'credit'
  status          TEXT NOT NULL DEFAULT 'issued', -- issued | paid | overdue | void
  paid_at         TIMESTAMPTZ,
  pdf_path        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id, status);
