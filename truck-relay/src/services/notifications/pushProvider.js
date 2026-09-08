/**
 * pushProvider.js — Firebase Cloud Messaging adapter.
 * Swap this file's internals if you use a different push provider
 * (OneSignal, AWS SNS, etc) — the interface (sendPush) is what the
 * rest of the app depends on.
 */

const admin = require('firebase-admin');

let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FCM_PROJECT_ID,
      clientEmail: process.env.FCM_CLIENT_EMAIL,
      privateKey: process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
  initialized = true;
}

/**
 * Sends a push notification to one or more device tokens.
 * Returns { successCount, failureCount, invalidTokens } — invalidTokens
 * should be pruned from device_tokens by the caller.
 */
async function sendPush(tokens, { title, body, data = {} }) {
  ensureInitialized();
  if (!tokens.length) return { successCount: 0, failureCount: 0, invalidTokens: [] };

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])), // FCM data payload must be string values
  });

  const invalidTokens = [];
  response.responses.forEach((r, i) => {
    if (!r.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(r.error?.code)) {
      invalidTokens.push(tokens[i]);
    }
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
  };
}

module.exports = { sendPush };
