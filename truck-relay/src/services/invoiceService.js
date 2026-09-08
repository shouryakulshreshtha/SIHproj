/**
 * invoiceService.js — generates the invoice PDF and the sequential
 * invoice number. Doesn't decide prepaid vs credit — that's
 * creditBillingService.js; this file just renders whatever invoice
 * record it's given.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');

const GST_PERCENT = Number(process.env.GST_PERCENT || 18);
const STORAGE_DIR = process.env.INVOICE_STORAGE_DIR || path.join(process.cwd(), 'storage', 'invoices');
// In production, swap this for an S3 upload and store the S3 key/URL
// in invoices.pdf_path instead of a local filesystem path.

fs.mkdirSync(STORAGE_DIR, { recursive: true });

/**
 * Atomically generates the next sequential invoice number for the
 * current year, e.g. INV-2026-000042.
 */
async function nextInvoiceNumber(client) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `INSERT INTO invoice_sequence (year, last_number) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_number = invoice_sequence.last_number + 1
     RETURNING last_number`,
    [year]
  );
  const number = String(rows[0].last_number).padStart(6, '0');
  return `INV-${year}-${number}`;
}

/**
 * Creates the invoice DB row + PDF for a booking. billingMode and
 * dueDate are passed in by the caller (creditBillingService for B2B,
 * or directly for prepaid) rather than decided here.
 */
async function createInvoice(client, { bookingId, customerId, billingMode, dueDate, lineItems, billingDetails }) {
  const subtotalPaise = lineItems.reduce((sum, item) => sum + item.amountPaise, 0);
  const taxPaise = Math.round((subtotalPaise * GST_PERCENT) / 100);
  const totalPaise = subtotalPaise + taxPaise;

  const invoiceNumber = await nextInvoiceNumber(client);

  const { rows } = await client.query(
    `INSERT INTO invoices (invoice_number, booking_id, customer_id, billing_mode, subtotal_paise, tax_paise, total_paise, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, invoice_number, issued_at`,
    [invoiceNumber, bookingId, customerId, billingMode, subtotalPaise, taxPaise, totalPaise, dueDate || null]
  );
  const invoice = rows[0];

  const pdfPath = await renderInvoicePdf({
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    dueDate,
    billingMode,
    lineItems,
    subtotalPaise,
    taxPaise,
    totalPaise,
    billingDetails,
  });

  await client.query(`UPDATE invoices SET pdf_path = $1 WHERE id = $2`, [pdfPath, invoice.id]);

  return { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, totalPaise, pdfPath };
}

function renderInvoicePdf({ invoiceNumber, issuedAt, dueDate, billingMode, lineItems, subtotalPaise, taxPaise, totalPaise, billingDetails }) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(STORAGE_DIR, `${invoiceNumber}.pdf`);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(20).text('TAX INVOICE', { align: 'right' });
    doc.fontSize(10).text(`Invoice #: ${invoiceNumber}`, { align: 'right' });
    doc.text(`Date: ${new Date(issuedAt).toLocaleDateString('en-IN')}`, { align: 'right' });
    if (dueDate) doc.text(`Due: ${new Date(dueDate).toLocaleDateString('en-IN')}`, { align: 'right' });
    doc.moveDown();

    doc.fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(10).text(billingDetails?.companyName || billingDetails?.name || 'Customer');
    if (billingDetails?.gstin) doc.text(`GSTIN: ${billingDetails.gstin}`);
    if (billingDetails?.address) doc.text(billingDetails.address);
    doc.moveDown();

    doc.fontSize(12).text(billingMode === 'credit' ? 'Billing mode: Credit (Net terms)' : 'Billing mode: Prepaid');
    doc.moveDown();

    // Line items table (simple layout — swap for a table library if you need more polish)
    doc.fontSize(11).text('Description', 50, doc.y, { continued: true, width: 300 });
    doc.text('Amount (₹)', { align: 'right' });
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke();
    doc.moveDown(0.5);

    lineItems.forEach((item) => {
      doc.fontSize(10).text(item.description, 50, doc.y, { continued: true, width: 300 });
      doc.text((item.amountPaise / 100).toFixed(2), { align: 'right' });
    });

    doc.moveDown();
    doc.moveTo(300, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Subtotal: ₹${(subtotalPaise / 100).toFixed(2)}`, { align: 'right' });
    doc.text(`GST (${GST_PERCENT}%): ₹${(taxPaise / 100).toFixed(2)}`, { align: 'right' });
    doc.fontSize(12).text(`Total: ₹${(totalPaise / 100).toFixed(2)}`, { align: 'right' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { createInvoice };
