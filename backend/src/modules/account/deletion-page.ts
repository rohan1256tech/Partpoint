/**
 * Public "Delete your account" page (Google Play requires a web link, not only the in-app option).
 * Self-contained: no external assets, so it works with a strict Content-Security-Policy.
 */
export const deletionPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delete your Partpoint account</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #5c5c5c; --bg: #fff; --line: #d9d9d9; --accent: #b42318; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececec; --muted: #a3a3a3; --bg: #141414; --line: #333; --accent: #f97066; } }
  body { margin: 0; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 38rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .75rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
  p, li { color: var(--muted); }
  ul { padding-left: 1.2rem; }
  label { display: block; font-weight: 600; margin: 1.25rem 0 .35rem; }
  input, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: .65rem .75rem; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--fg); }
  textarea { min-height: 5rem; resize: vertical; }
  button { margin-top: 1.5rem; font: inherit; font-weight: 600; padding: .7rem 1.25rem; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: default; }
  #status { margin-top: 1rem; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Delete your Partpoint account</h1>
  <p>This page is for the <strong>Partpoint</strong> and <strong>Partpoint Delivery</strong> apps.
     The quickest way is in the app: <em>Account → Delete account</em>. You can also ask us here.</p>

  <h2>What is deleted</h2>
  <ul>
    <li>Your name, phone number, email address and password</li>
    <li>Saved addresses, cart, wishlist and notification settings</li>
    <li>Your product listings (wholesalers) or delivery availability (delivery partners)</li>
  </ul>
  <h2>What is kept, and why</h2>
  <ul>
    <li>Records of past orders and invoices, as required by Indian GST law (retained for 8 years), used for no other purpose</li>
  </ul>
  <p>Accounts with orders in progress or payments not yet settled are closed once those are complete.
     We will contact you on the number or email you give below to confirm the request, usually within 7 days.</p>

  <form id="f" novalidate>
    <label for="contact">Phone number or email of your account</label>
    <input id="contact" name="contact" autocomplete="username" required maxlength="254">
    <label for="reason">Reason (optional)</label>
    <textarea id="reason" name="reason" maxlength="500"></textarea>
    <button id="b" type="submit">Request deletion</button>
    <p id="status" role="status" aria-live="polite"></p>
  </form>
</main>
<script>
  const f = document.getElementById('f'), b = document.getElementById('b'), s = document.getElementById('status');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const contact = f.contact.value.trim();
    if (!contact) { s.textContent = 'Enter your phone number or email.'; return; }
    b.disabled = true; s.textContent = 'Sending…';
    try {
      const body = { contact };
      if (f.reason.value.trim()) body.reason = f.reason.value.trim();
      const r = await fetch('/v1/account-deletion-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 202) { f.reset(); s.textContent = 'Request received. We will contact you to confirm.'; }
      else if (r.status === 400) { s.textContent = 'Please enter a valid Indian mobile number or email address.'; }
      else if (r.status === 429) { s.textContent = 'Too many requests. Please try again later.'; }
      else { s.textContent = 'Something went wrong. Please try again.'; }
    } catch { s.textContent = 'Network error. Please try again.'; }
    b.disabled = false;
  });
</script>
</body>
</html>
`;
