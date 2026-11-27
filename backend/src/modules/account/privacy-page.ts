/**
 * Public privacy policy (Google Play requires a URL; the DPDP Act 2023 requires the notice).
 * It describes what the apps actually do; keep it in step with the code and the Play Data safety
 * form, and bump CONSENT_VERSION when the substance changes. Have it reviewed by a lawyer before launch.
 */
export interface PrivacyPageOptions {
  legalName?: string;
  legalAddress?: string;
  grievanceOfficer?: string;
  privacyEmail?: string;
  version: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const missing = (label: string) => `<mark>[${label} not set]</mark>`;

export function privacyPage(o: PrivacyPageOptions): string {
  const name = o.legalName ? esc(o.legalName) : missing('Business name');
  const address = o.legalAddress ? esc(o.legalAddress) : missing('Address');
  const officer = o.grievanceOfficer ? esc(o.grievanceOfficer) : missing('Grievance officer');
  const email = o.privacyEmail ? `<a href="mailto:${esc(o.privacyEmail)}">${esc(o.privacyEmail)}</a>` : missing('Privacy email');
  const version = esc(o.version);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy · Partpoint</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #4d4d4d; --bg: #fff; --line: #e3e3e3; --link: #1f6fd1; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececec; --muted: #b5b5b5; --bg: #141414; --line: #2e2e2e; --link: #8db8f2; } }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 .25rem; }
  h2 { font-size: 1.1rem; margin: 2.25rem 0 .5rem; padding-top: 1rem; border-top: 1px solid var(--line); }
  p, li { color: var(--muted); }
  ul { padding-left: 1.2rem; }
  li { margin: .25rem 0; }
  strong { color: var(--fg); }
  a { color: var(--link); }
  .meta { font-size: .9rem; }
  table { border-collapse: collapse; width: 100%; font-size: .95rem; }
  th, td { text-align: left; vertical-align: top; padding: .5rem .5rem .5rem 0; border-bottom: 1px solid var(--line); color: var(--muted); }
  th { color: var(--fg); }
  mark { background: #fde68a; color: #1a1a1a; padding: 0 .2rem; }
</style>
</head>
<body>
<main>
  <h1>Privacy policy</h1>
  <p class="meta">For the <strong>Partpoint</strong> and <strong>Partpoint Delivery</strong> Android apps and the services behind them.
     Version ${version}.</p>

  <p>Partpoint is a business-to-business marketplace for mobile phone spare parts and accessories. Retailers
     order from Partpoint's catalog, Partpoint passes each order to a wholesaler that has the stock, and delivery
     partners take the goods from the wholesaler to the retailer. This policy explains what
     personal data we collect, why, who sees it, how long we keep it, and your rights under India's
     Digital Personal Data Protection Act, 2023.</p>
  <p>The business responsible for your data (the "Data Fiduciary") is <strong>${name}</strong>, ${address}.</p>

  <h2>What we collect</h2>
  <table>
    <tr><th>Data</th><th>Why</th></tr>
    <tr><td>Name, mobile number, email address (if you use one) and a password (stored only as a secure hash)</td><td>To create your account, sign you in and contact you about your orders</td></tr>
    <tr><td>Shop or business name, GSTIN (optional), business address (wholesalers), vehicle type and number (delivery partners)</td><td>To check that accounts belong to real businesses, and for GST invoices</td></tr>
    <tr><td>Delivery addresses with a contact name and phone number</td><td>To deliver your orders</td></tr>
    <tr><td>Orders, invoices, payments recorded, delivery status, ratings and reviews</td><td>To run the marketplace, issue GST invoices, settle payments to sellers and riders, and resolve disputes</td></tr>
    <tr><td>The stock and supply prices that wholesalers enter</td><td>To choose which wholesaler fulfils each order</td></tr>
    <tr><td>A random identifier created by the app, a push-notification token, the app version, and IP addresses in security logs</td><td>To keep your account secure, sign you out of lost devices, and send you notifications</td></tr>
  </table>
  <p><strong>We do not collect</strong> your location, contacts, SMS messages, call logs, photos other than ones you choose to upload, or an advertising ID.
     The apps show no advertising and we do not sell personal data. Sign-in codes are filled in from the SMS by your keyboard; the apps cannot read your messages.
     When a delivery partner taps "Navigate", the address is opened in Google Maps, which works under Google's own privacy policy.</p>

  <h2>Who can see your data</h2>
  <ul>
    <li><strong>The other people in an order</strong>, only as much as they need: the wholesaler fulfilling it sees the retailer's shop name and delivery area (city and PIN code), and its business details appear on the GST invoice the retailer receives;
        the delivery partner sees the pickup and delivery addresses and phone numbers; the retailer sees the delivery partner's name and phone number.</li>
    <li><strong>Partpoint staff</strong> who approve accounts, handle orders and support. Admin access requires two-factor authentication and is logged.</li>
    <li><strong>Service providers</strong> that run parts of the service for us under contract, only for that purpose:
        our server host, Cloudflare (network security and image storage), an SMS provider (sign-in codes), an email provider (codes and account emails),
        and Google Firebase Cloud Messaging (notifications).</li>
    <li><strong>Authorities</strong>, when the law requires it, for example tax authorities for GST records.</li>
  </ul>
  <p>Ratings and reviews are shown to other business users with your first name only.</p>

  <h2>How long we keep it</h2>
  <ul>
    <li>Your account data is kept while your account is open. When you delete your account, your name, phone number, email, password,
        addresses, cart, wishlist, devices and sign-in sessions are erased.</li>
    <li>Order and invoice records are kept for the period Indian GST law requires (currently about eight years), and used for nothing else.</li>
    <li>Sign-in codes expire within minutes. Security logs are kept only as long as needed to protect the service and investigate misuse.</li>
  </ul>

  <h2>How we protect it</h2>
  <p>All connections are encrypted (HTTPS). Passwords are stored only as secure hashes. On your phone, sign-in tokens are encrypted with a key kept in
     Android's secure keystore and are excluded from backups. Screens that show sign-in or delivery codes block screenshots.</p>

  <h2>Your rights</h2>
  <p>Under the DPDP Act you can:</p>
  <ul>
    <li><strong>See and correct</strong> your data: most of it is visible and editable in the app; for anything else, write to us.</li>
    <li><strong>Erase</strong> your data and withdraw consent: delete your account in the app (Account → Delete account) or on our
        <a href="/account/delete">account deletion page</a>.</li>
    <li><strong>Raise a grievance</strong> with our Grievance Officer (below). If you are not satisfied with our reply, you may complain to the
        Data Protection Board of India.</li>
    <li><strong>Nominate</strong> someone to exercise these rights for you in case of death or incapacity, by writing to us.</li>
  </ul>
  <p>We aim to answer every request within 30 days.</p>

  <h2>Age</h2>
  <p>Partpoint is for businesses and their staff. You must be 18 or older to use it.</p>

  <h2>Changes</h2>
  <p>If we change this policy in a way that matters, we will tell you in the app and ask for your consent again where the law requires it.
     The version above shows which policy you agreed to.</p>

  <h2>Contact and Grievance Officer</h2>
  <p><strong>${officer}</strong><br>${name}<br>${address}<br>Email: ${email}</p>
</main>
</body>
</html>`;
}
