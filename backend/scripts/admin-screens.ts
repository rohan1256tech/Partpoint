/**
 * Screenshots of the admin panel for visual review, signed in through the real login and 2FA.
 * Creates a temporary admin, drives a headless Chrome over the DevTools protocol, saves PNGs,
 * then disables the admin. Development only.
 *
 *   pnpm exec tsx --env-file=.env scripts/admin-screens.ts <outDir> [panelUrl] [light|dark]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../src/config/env.js';
import { createDb } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';
import { hotp, newTotpSecret, SecretBox, timeStep } from '../src/lib/totp.js';

const [outDir = 'screens', panel = 'http://localhost:5173', scheme = 'light'] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGES: [string, string][] = [
  ['dashboard', '/'],
  ['orders', '/orders'],
  ['orders-waiting', '/orders?tab=placed'],
  ['products', '/catalog/products'],
  ['users', '/users'],
  ['finance', '/finance'],
  ['settings', '/settings'],
];

const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('Not in production');
const { db, pool } = createDb(env.DATABASE_URL, 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const email = `screens-${Date.now()}@partpoint.local`;
const password = `screens-${newTotpSecret().toString('hex')}`;
const totp = newTotpSecret();
const [row] = await db
  .insert(users)
  .values({
    role: 'admin',
    status: 'approved',
    name: 'Rohan Review',
    email,
    emailVerifiedAt: new Date(),
    passwordHash: await hashPassword(password),
    totpSecret: new SecretBox(env.OTP_SECRET).seal(totp),
    totpEnabledAt: new Date(),
  })
  .returning({ id: users.id });

mkdirSync(outDir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--window-size=1440,900',
  '--hide-scrollbars',
  `--user-data-dir=${join(outDir, '.profile')}`,
  'about:blank',
]);

try {
  let wsUrl = '';
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(250);
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? '';
    } catch {
      /* not up yet */
    }
  }
  if (!wsUrl) throw new Error('Chrome did not start');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 0;
  const pending = new Map<number, (v: unknown) => void>();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
    if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
  });
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = (expression: string) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  const go = async (path: string) => {
    await send('Page.navigate', { url: panel + path });
    await sleep(2500);
  };
  // React inputs need the native setter plus an input event.
  const type = (selector: string, value: string) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  await go('/login');
  await type('input[type=email]', email);
  await type('input[type=password]', password);
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
  await sleep(2000);
  // The PIN input: type the code into the first box, one digit per field.
  const code = hotp(totp, timeStep());
  await evaluate(`(() => { const inputs = [...document.querySelectorAll('input[inputmode=numeric]')];
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inputs.forEach((el, i) => { set.call(el, ${JSON.stringify(code)}[i]); el.dispatchEvent(new Event('input', { bubbles: true })); }); })()`);
  await sleep(500);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Verify'))?.click()`);
  await sleep(3000);

  for (const [name, path] of PAGES) {
    await go(path);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(outDir, `${scheme}-${name}.png`), Buffer.from(shot.data, 'base64'));
    process.stdout.write(`saved ${scheme}-${name}.png\n`);
  }
  ws.close();
} finally {
  chrome.kill();
  if (row) await db.update(users).set({ passwordHash: null, totpSecret: null, totpEnabledAt: null, deletedAt: new Date() }).where(eq(users.id, row.id));
  await pool.end();
}
