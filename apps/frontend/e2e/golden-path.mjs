#!/usr/bin/env node
/* Single-profile golden-path sweep.
 *
 * Walks: login → dashboard → factories list → factory detail → settings.
 * Captures a screenshot at each step. Fails loud if any step throws or
 * if the browser console emits errors.
 *
 * Run with:
 *   WALLET_URL=http://localhost:2103 \
 *     WALLET_PASSWORD=demopassword \
 *     CHROME_PATH=/usr/bin/google-chrome \
 *     node apps/frontend/e2e/golden-path.mjs
 *
 * See e2e/README.md for the full env-var list. */

import { ENV, launch, login, sleep, shot, record, summarize } from './lib/helpers.mjs';

const ctx = { steps: [], errors: [] };
const { browser, page } = await launch();

page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') {
    ctx.errors.push({ type: t, text: m.text().slice(0, 200) });
  }
});
page.on('pageerror', (e) => ctx.errors.push({ type: 'pageerror', text: e.message.slice(0, 200) }));

try {
  await record(ctx, 'login', async () => {
    await login(page);
    await shot(page, '01-after-login');
  });

  await record(ctx, 'dashboard', async () => {
    await page.goto(`${ENV.WALLET_URL}/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="container"]', { timeout: 15000 });
    await shot(page, '02-dashboard');
  });

  await record(ctx, 'factories-list', async () => {
    await page.goto(`${ENV.WALLET_URL}/#/factories`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    await shot(page, '03-factories-list');
  });

  await record(ctx, 'open-settings-glossary', async () => {
    /* Click the settings toggle, then the Glossary item. Confirms R3.4
     * Glossary modal is wired and the Settings dropdown is reachable. */
    await page.click('[data-testid="settings"] button');
    await sleep(200);
    const opened = await page.evaluate(() => {
      const item = document.querySelector('[data-testid="settings-glossary"]');
      if (item) { item.click(); return true; }
      return false;
    });
    if (!opened) throw new Error('Settings → Glossary not clickable');
    await sleep(300);
    await shot(page, '04-glossary-modal');
    /* Close it. */
    await page.click('[data-testid="glossary-close"]');
    await sleep(200);
  });

  await record(ctx, 'open-whats-new', async () => {
    await page.click('[data-testid="settings"] button');
    await sleep(200);
    const opened = await page.evaluate(() => {
      const item = document.querySelector('[data-testid="settings-whats-new"]');
      if (item) { item.click(); return true; }
      return false;
    });
    if (!opened) throw new Error('Settings → What\'s new not clickable');
    await sleep(500);
    await shot(page, '05-whats-new-modal');
    await page.click('[data-testid="whats-new-close"]');
    await sleep(200);
  });
} catch (err) {
  console.error('Aborted:', err.message);
} finally {
  summarize(ctx);
  await browser.close();
  process.exit(ctx.steps.some((s) => !s.ok) || ctx.errors.length > 0 ? 1 : 0);
}
