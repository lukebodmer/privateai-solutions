/**
 * The only server-side code on the site: the contact form.
 *
 * Every page is a static asset served straight out of dist. This Worker runs
 * for /api/* only (assets.run_worker_first in wrangler.jsonc), and a
 * submission is emailed to the address the send_email binding names, with the
 * visitor's address in Reply-To so that replying goes back to them.
 *
 * Nothing is stored: the message exists in the inbox and nowhere else.
 */

const DESTINATION = 'lukejbodmer@gmail.com';
const FROM = 'noreply@privateai.solutions';
const MAX_BODY = 20_000;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api/contact') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    }
    return contact(request, env);
  },
};

async function contact(request, env) {
  if (!(request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    return fail('Unsupported request body.', 415);
  }
  const body = await request.text();
  if (body.length > MAX_BODY) return fail('That message is too long.', 413);

  const form = new URLSearchParams(body);
  // A field no visitor sees. A bot that fills it gets the same answer a person
  // does, so it learns nothing about why it failed.
  if (form.get('website')) return back();

  const name = line(form.get('name'));
  const email = line(form.get('email'));
  const topic = line(form.get('subject'));
  const message = (form.get('body') ?? '').trim();

  if (!name || !email || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail('Please give your name, a valid email address and a message.', 400);
  }

  const subject = `Contact form: ${topic || 'General'} — ${name}`;
  try {
    await env.CONTACT.send({
      to: DESTINATION,
      from: { email: FROM, name: 'Private AI Solutions' },
      replyTo: email,
      subject,
      text: [`Name:  ${name}`, `Email: ${email}`, `Topic: ${topic || '—'}`, '', message].join('\n'),
      html: [
        `<p><strong>Name:</strong> ${escape(name)}<br>`,
        `<strong>Email:</strong> ${escape(email)}<br>`,
        `<strong>Topic:</strong> ${escape(topic || '—')}</p>`,
        `<p style="white-space:pre-wrap">${escape(message)}</p>`,
      ].join(''),
    });
  } catch (err) {
    console.error('contact form: send failed', err?.code ?? '', err?.message ?? err);
    return fail('The message could not be sent. Please email info@privateai.solutions directly.', 500);
  }
  return back();
}

/** One line of user input: trimmed, with anything that would split a header removed. */
function line(value) {
  return (value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function escape(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function back() {
  return new Response(null, { status: 303, headers: { Location: '/contact/thanks/' } });
}

function fail(message, status) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Message not sent</title>` +
    `<body style="font:16px/1.5 system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">` +
    `<h1 style="font-size:1.5rem">Message not sent</h1>` +
    `<p>${escape(message)}</p><p><a href="/contact/">Back to contact</a></p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
