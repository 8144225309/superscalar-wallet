import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

export const ENV = {
  WALLET_URL: process.env.WALLET_URL || 'http://localhost:2103',
  WALLET_PASSWORD: process.env.WALLET_PASSWORD || '',
  CHROME_PATH: process.env.CHROME_PATH || defaultChromePath(),
  SHOT_DIR: process.env.SHOT_DIR || '/tmp/soupwallet-e2e',
  HEADLESS: process.env.HEADLESS === 'false' ? false : 'new',
  LSP_PROFILE: process.env.LSP_PROFILE || 'alice',
  CLIENT_PROFILE: process.env.CLIENT_PROFILE || 'bob',
};

function defaultChromePath() {
  /* Reasonable per-platform defaults so the script "just works" on
   * common dev boxes. Override with CHROME_PATH if you have a
   * non-standard install. */
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  return '/usr/bin/google-chrome';
}

export async function launch() {
  mkdirSync(ENV.SHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: ENV.CHROME_PATH,
    headless: ENV.HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1440,900',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  return { browser, page };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function shot(page, name) {
  await page.screenshot({ path: resolve(ENV.SHOT_DIR, `${name}.png`), fullPage: true });
}

/* Wallet password is SHA256-hashed by the frontend before submit. The
 * e2e scripts must do the same so the backend's hash compare succeeds. */
async function sha256Hex(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await (globalThis.crypto?.subtle || (await import('crypto')).webcrypto.subtle)
    .digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function login(page) {
  if (!ENV.WALLET_PASSWORD) {
    /* Assume APP_SINGLE_SIGN_ON=true; nothing to do. */
    return;
  }
  await page.goto(ENV.WALLET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  /* Find the password input in the login modal. The modal mounts via
   * the React tree, so wait for the rendering. */
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  const hashed = await sha256Hex(ENV.WALLET_PASSWORD);
  await page.evaluate((h) => {
    const input = document.querySelector('input[type="password"]');
    if (input) {
      /* Triggers React onChange */
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(input, h);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, hashed);
  await page.click('button[type="submit"]');
  await sleep(800);
}

export async function selectProfile(page, profileAlias) {
  /* Open the NodePicker dropdown and click the row whose label contains
   * the alias. Robust to alias ordering / dropdown style changes. */
  await page.click('[data-testid="node-picker-toggle"]');
  await sleep(200);
  const clicked = await page.evaluate((alias) => {
    const items = Array.from(document.querySelectorAll('[data-testid^="node-picker-item-"]'));
    const match = items.find((el) => el.textContent.toLowerCase().includes(alias.toLowerCase()));
    if (match) {
      match.click();
      return true;
    }
    return false;
  }, profileAlias);
  if (!clicked) {
    throw new Error(`Profile "${profileAlias}" not found in NodePicker dropdown`);
  }
  /* Profile switch fans out parallel data fetches (PR #68). Wait a beat
   * for the dashboard to settle. */
  await sleep(1500);
}

export function record(ctx, label, fn) {
  return (async () => {
    const t0 = Date.now();
    try {
      const result = await fn();
      ctx.steps.push({ label, ok: true, ms: Date.now() - t0 });
      return result;
    } catch (err) {
      ctx.steps.push({ label, ok: false, ms: Date.now() - t0, error: err.message });
      throw err;
    }
  })();
}

export function summarize(ctx) {
  const okCount = ctx.steps.filter((s) => s.ok).length;
  const failCount = ctx.steps.length - okCount;
  console.log(`\nSteps: ${okCount} ok / ${failCount} fail`);
  if (failCount > 0) {
    for (const s of ctx.steps.filter((s) => !s.ok)) {
      console.log(`  FAIL [${s.ms}ms] ${s.label}: ${s.error}`);
    }
  }
  if (ctx.errors.length) {
    console.log(`\nBrowser-side errors: ${ctx.errors.length}`);
    for (const e of ctx.errors.slice(0, 10)) {
      console.log(`  [${e.type}] ${e.text}`);
    }
  }
  console.log(`\nScreenshots: ${ENV.SHOT_DIR}`);
}
