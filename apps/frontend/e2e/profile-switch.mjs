#!/usr/bin/env node
/* Two-profile golden-path sweep (LSP perspective → client perspective).
 *
 * Walks: login → switch to LSP profile → snapshot → switch to client
 * profile → snapshot. Verifies the profile-switch UX (PR #68's
 * parallelized fetch + #160's event-driven health probe) works as
 * advertised: a switch finishes within a few seconds and the
 * dashboard updates without errors.
 *
 * Requires two profiles registered in the wallet. Defaults to "alice"
 * (LSP) and "bob" (client); override with LSP_PROFILE / CLIENT_PROFILE
 * env vars.
 *
 * Run with:
 *   WALLET_URL=http://localhost:2103 \
 *     WALLET_PASSWORD=demopassword \
 *     LSP_PROFILE=alice \
 *     CLIENT_PROFILE=bob \
 *     node apps/frontend/e2e/profile-switch.mjs */

import {
  ENV, launch, login, sleep, shot, selectProfile, record, summarize,
} from './lib/helpers.mjs';

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
  });

  await record(ctx, 'goto-factories', async () => {
    await page.goto(`${ENV.WALLET_URL}/#/factories`, { waitUntil: 'networkidle2' });
    await sleep(1500);
  });

  await record(ctx, `switch-to-${ENV.LSP_PROFILE}`, async () => {
    const t0 = Date.now();
    await selectProfile(page, ENV.LSP_PROFILE);
    const dt = Date.now() - t0;
    await shot(page, `01-lsp-${ENV.LSP_PROFILE}`);
    if (dt > 5000) {
      throw new Error(`Profile switch took ${dt}ms (>5s) — PR #68 perf regression?`);
    }
  });

  await record(ctx, 'lsp-sees-factories-or-empty', async () => {
    /* Either the LSP has factories (FactoryList renders rows) or the
     * empty-state placeholder shows. Both are valid; we just need to
     * confirm the React tree mounted without errors. */
    const ok = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="container"]');
    });
    if (!ok) throw new Error('container not rendered after profile switch');
  });

  await record(ctx, `switch-to-${ENV.CLIENT_PROFILE}`, async () => {
    const t0 = Date.now();
    await selectProfile(page, ENV.CLIENT_PROFILE);
    const dt = Date.now() - t0;
    await shot(page, `02-client-${ENV.CLIENT_PROFILE}`);
    if (dt > 5000) {
      throw new Error(`Profile switch took ${dt}ms (>5s)`);
    }
  });

  await record(ctx, 'client-dashboard-renders', async () => {
    const ok = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="container"]');
    });
    if (!ok) throw new Error('container not rendered after client profile switch');
  });
} catch (err) {
  console.error('Aborted:', err.message);
} finally {
  summarize(ctx);
  await browser.close();
  process.exit(ctx.steps.some((s) => !s.ok) || ctx.errors.length > 0 ? 1 : 0);
}
