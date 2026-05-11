// ============================================================
//  PRO MEDIA – OTP Backend Server
//  Stack : Node.js + Express + MSG91 (SMS & WhatsApp)
//  Author: Pro Media
// ============================================================

require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const axios       = require('axios');
const crypto      = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── In-memory OTP store  { phone → { otp, expires, attempts } }
const otpStore = new Map();

// ──────────────────────────────────────────
// MIDDLEWARE
// ──────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',   // set to your domain in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Serve frontend (index.html and any sibling static assets) from project root
app.use(express.static(__dirname));

// Global rate limit — 100 requests / 15 min per IP
app.use(rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 100,
  message  : { success: false, message: 'Too many requests. Please try again later.' }
}));

// OTP-specific rate limit — max 3 OTPs per phone per 10 min
const otpLimiter = rateLimit({
  windowMs : 10 * 60 * 1000,
  max      : 3,
  keyGenerator: (req) => req.body.phone || req.ip,
  message  : { success: false, message: 'Too many OTP requests. Please wait 10 minutes.' }
});

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────

/** Generate a secure 6-digit OTP */
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

/** Validate Indian mobile number (10 digits, starts 6-9) */
function isValidIndianNumber(phone) {
  return /^[6-9]\d{9}$/.test(phone);
}

/** Send OTP via adbizzdigital SMS panel (DLT-compliant transactional route). */
async function sendSMS(phone, otp) {
  const apiUrl   = process.env.SMS_API_URL || 'https://login.adbizzdigital.com/sms-panel/api/http/index.php';
  const template = process.env.SMS_TEMPLATE_TEXT || 'Your OTP for registration is {#var#}. Valid for 10 Mins. KSN Lunch Box Y2nx';
  const message  = template.replace('{#var#}', otp);

  const body = new URLSearchParams({
    username   : process.env.SMS_USERNAME   || '',
    apikey     : process.env.SMS_API_KEY    || '',
    apirequest : 'Text',
    route      : 'TRANS',                                  // transactional route (OTP)
    sender     : process.env.SMS_SENDER_ID  || '',         // 6-char DLT sender ID (e.g. YTWONX)
    mobile     : phone,                                    // 10-digit Indian number, no country code
    message    : message,
    TemplateID : process.env.SMS_TEMPLATE_ID || '',        // DLT template ID
    format     : 'JSON'
  });

  const res = await axios.post(apiUrl, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });

  // Log full response on first deploy so we can confirm the exact success/error shape.
  console.log('[SMS API RESPONSE]', typeof res.data === 'string' ? res.data : JSON.stringify(res.data));

  // Defensive success detection — different reseller panels use slightly different keys.
  const data = res.data || {};
  const errorCode = data.ErrorCode ?? data.errorCode ?? data.error_code;
  const errorMsg  = data.ErrorMessage ?? data.errorMessage ?? data.error_message ?? data.message;
  const status    = (data.Status ?? data.status ?? '').toString().toLowerCase();

  if (errorCode !== undefined && !['000', '0', 0].includes(errorCode)) {
    throw new Error(`SMS provider error ${errorCode}: ${errorMsg || 'unknown'}`);
  }
  if (status === 'error' || status === 'failed') {
    throw new Error(`SMS provider error: ${errorMsg || 'unknown'}`);
  }
  return data;
}

// ──────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────

/** Health check */
app.get('/health', (_, res) => res.json({ status: 'OK', service: 'Pro Media OTP API' }));

// ── 1. SEND OTP (SMS only) ───────────────
app.post('/api/otp/send', otpLimiter, async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone || !isValidIndianNumber(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number. Must be 10-digit Indian number.' });
    }

    const otp = generateOTP();
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
    otpStore.set(phone, { otp, expires, attempts: 0, channel: 'sms' });

    await sendSMS(phone, otp);

    console.log(`[OTP] Sent to +91${phone} via SMS`);

    return res.json({
      success: true,
      message: `OTP sent via SMS to +91${phone.slice(0,5)}XXXXX`,
      expires_in: 600
    });

  } catch (err) {
    console.error('[OTP SEND ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
  }
});

// ── 2. VERIFY OTP ────────────────────────
app.post('/api/otp/verify', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });
    }

    const record = otpStore.get(phone);

    if (!record) {
      return res.status(400).json({ success: false, message: 'OTP not found. Please request a new OTP.' });
    }
    if (Date.now() > record.expires) {
      otpStore.delete(phone);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }
    if (record.attempts >= 5) {
      otpStore.delete(phone);
      return res.status(400).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
    }

    record.attempts++;

    if (record.otp !== otp.toString()) {
      return res.status(400).json({
        success   : false,
        message   : `Incorrect OTP. ${5 - record.attempts} attempts remaining.`,
        remaining : 5 - record.attempts
      });
    }

    // ✅ OTP correct — issue a verification token
    otpStore.delete(phone);
    const token = crypto.randomBytes(32).toString('hex');

    // Store token briefly (30 min) for form submit
    verifiedTokens.set(token, { phone, expires: Date.now() + 30 * 60 * 1000 });

    console.log(`[OTP] Verified for +91${phone}`);

    return res.json({ success: true, message: 'Phone number verified!', token });

  } catch (err) {
    console.error('[OTP VERIFY ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Verification failed. Please try again.' });
  }
});

// ── 3. RESEND OTP (SMS only) ─────────────
app.post('/api/otp/resend', otpLimiter, async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone || !isValidIndianNumber(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number.' });
    }

    const otp = generateOTP();
    const expires = Date.now() + 10 * 60 * 1000;
    otpStore.set(phone, { otp, expires, attempts: 0, channel: 'sms' });

    await sendSMS(phone, otp);

    console.log(`[OTP] Resent to +91${phone} via SMS`);

    return res.json({ success: true, message: 'New OTP sent successfully.', expires_in: 600 });

  } catch (err) {
    console.error('[OTP RESEND ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to resend OTP.' });
  }
});

// ── 4. SUBMIT LEAD ───────────────────────
const verifiedTokens = new Map();

app.post('/api/lead/submit', async (req, res) => {
  try {
    const { name, phone, daily_spend, channel, verification_token } = req.body;

    // Validate token
    const tokenData = verifiedTokens.get(verification_token);
    if (!tokenData || Date.now() > tokenData.expires || tokenData.phone !== phone) {
      return res.status(401).json({ success: false, message: 'Phone not verified or session expired.' });
    }
    verifiedTokens.delete(verification_token);

    // Validate fields
    if (!name || name.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Invalid name.' });
    }
    if (!daily_spend || isNaN(daily_spend)) {
      return res.status(400).json({ success: false, message: 'Invalid spend amount.' });
    }

    const lead = {
      id         : crypto.randomUUID(),
      name       : name.trim(),
      phone,
      daily_spend: parseInt(daily_spend),
      channel,
      submitted_at: new Date().toISOString(),
      ip         : req.ip
    };

    // ── TODO: Save to your database here ──
    // e.g. await db.collection('leads').insertOne(lead);
    console.log('[NEW LEAD]', JSON.stringify(lead, null, 2));

    // ── TODO: Notify your team (email / WhatsApp alert) ──
    // e.g. await sendSlackAlert(lead);

    return res.json({
      success: true,
      message: 'Lead submitted successfully!',
      lead_id: lead.id
    });

  } catch (err) {
    console.error('[LEAD SUBMIT ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Submission failed. Please try again.' });
  }
});

// ──────────────────────────────────────────
// CLEANUP — remove expired OTPs every 5 min
// ──────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [phone, record] of otpStore) {
    if (now > record.expires) otpStore.delete(phone);
  }
  for (const [token, data] of verifiedTokens) {
    if (now > data.expires) verifiedTokens.delete(token);
  }
}, 5 * 60 * 1000);

// ──────────────────────────────────────────
// START SERVER
// ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   PRO MEDIA OTP Server — Running      ║
  ║   Port  : ${PORT}                          ║
  ║   ENV   : ${process.env.NODE_ENV || 'development'}                ║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
