import { createHash } from 'node:crypto';

const RECIPIENT = 'ownaleebhattie1@gmail.com';
const SERVICES = new Set([
  'Reels & video editing', 'Graphic posts & design', 'Motion graphics',
  'On-location shoot + editing', 'Ongoing content creation', 'Help deciding'
]);
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (code, error) => res.status(code).json({ ok: false, error });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(405, 'Please submit the enquiry form on our website.');
  }
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) {
        return fail(403, 'Please submit your enquiry from our website.');
      }
    } catch {
      return fail(403, 'Please submit your enquiry from our website.');
    }
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return fail(415, 'Please submit the enquiry form on our website.');
  }
  let body;
  try {
    body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 16000) {
      return fail(413, 'Your enquiry is too long. Please shorten it.');
    }
  } catch {
    return fail(400, 'Please check your enquiry and try again.');
  }
  if (body.website) return fail(400, 'Unable to submit this enquiry.');
  const fields = {};
  for (const [key, limit, required] of [
    ['name', 100, true], ['email', 254, true], ['business', 150, true],
    ['city', 100, true], ['service', 80, true], ['message', 1500, false]
  ]) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      return fail(400, 'Please check the form fields and try again.');
    }
    const value = (body[key] || '').trim();
    if ((required && !value) || value.length > limit ||
      (key !== 'message' && /[\r\n\x00]/.test(value))) {
      return fail(400, 'Please complete the required fields within the allowed lengths.');
    }
    fields[key] = value;
  }
  if (!EMAIL_PATTERN.test(fields.email)) return fail(400, 'Please enter a valid email address.');
  if (!SERVICES.has(fields.service)) return fail(400, 'Please select a service from the list.');

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ENQUIRY_FROM_EMAIL;
  if (!apiKey || !from) {
    return fail(503, 'The enquiry form is temporarily unavailable. Please email ownaleebhattie1@gmail.com or message @own.vfx on Instagram.');
  }
  const text = [
    'New enquiry from the own.vfx website', '',
    'Name: ' + fields.name,
    'Email: ' + fields.email,
    'Business: ' + fields.business,
    'City / location: ' + fields.city,
    'Service: ' + fields.service, '',
    'Goal / message:', fields.message || 'No additional message.', '',
    'Reply to this email to contact the enquirer.'
  ].join('\n');
  const email = {
    from, to: [RECIPIENT], reply_to: fields.email,
    subject: 'own.vfx enquiry — ' + fields.business,
    text
  };
  // Duplicate clicks/retries with identical content within this window use one email.
  const id = createHash('sha256').update(JSON.stringify({
    email, window: Math.floor(Date.now() / 600000)
  })).digest('hex');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'own-vfx-' + id
      },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      console.error('Contact email provider status:', response.status);
      return fail(502, 'We couldn’t submit your enquiry. Please email ownaleebhattie1@gmail.com or try again later.');
    }
    const result = await response.json();
    if (!result?.id) return fail(502, 'Submission could not be confirmed. Please email ownaleebhattie1@gmail.com.');
    return res.status(200).json({ ok: true });
  } catch {
    return fail(502, 'Submission could not be confirmed. Please email ownaleebhattie1@gmail.com before trying again.');
  }
}
