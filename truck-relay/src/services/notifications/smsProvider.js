/**
 * smsProvider.js — Twilio SMS adapter.
 * Swap for MSG91 / AWS SNS / etc if that's your gateway — the rest of
 * the app only calls sendSms(to, message).
 */

const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_NUMBER = process.env.TWILIO_SMS_FROM;

async function sendSms(toE164, message) {
  const result = await client.messages.create({
    from: FROM_NUMBER,
    to: toE164, // must be E.164 format, e.g. +91XXXXXXXXXX
    body: message,
  });
  return { providerMessageId: result.sid, status: result.status };
}

module.exports = { sendSms };
