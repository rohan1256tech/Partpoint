import { afterEach, describe, expect, it } from 'vitest';
import { privacyPage } from '../src/modules/account/privacy-page.js';
import { createTestApp, type TestContext } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('privacy policy page', () => {
  it('is public HTML with the configured business and grievance contact', async () => {
    t = await createTestApp({
      LEGAL_NAME: 'Sharma Trading Co. <Pvt> Ltd',
      LEGAL_ADDRESS: '12 MG Road, Pune 411001',
      GRIEVANCE_OFFICER: 'Asha Kulkarni',
      PRIVACY_EMAIL: 'privacy@example.in',
      CONSENT_VERSION: '2026-11-01',
    });
    const res = await t.app.inject({ method: 'GET', url: '/privacy' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.body).toContain('Sharma Trading Co. &lt;Pvt&gt; Ltd'); // escaped
    expect(res.body).toContain('mailto:privacy@example.in');
    expect(res.body).toContain('Asha Kulkarni');
    expect(res.body).toContain('Version 2026-11-01');
    expect(res.body).toContain('href="/account/delete"');
    expect(res.body).not.toContain('not set');
  });

  it('flags missing details instead of hiding them', () => {
    const html = privacyPage({ version: 'v1' });
    expect(html).toContain('[Business name not set]');
    expect(html).toContain('[Grievance officer not set]');
  });
});
