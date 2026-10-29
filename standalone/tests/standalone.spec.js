// The standalone page end to end, with the provider mocked: a fresh server and data folder for each test.
import { test, expect } from '@playwright/test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRAW, PICK_FILES, startLife } from '../../tests/support/harness.js';
import { buildPage } from '../page.js';
import { openServer, tempDir } from './support.js';

const reply = {
  narration: 'A fresh scene unfolds.',
  choices: ['Explore'],
  system: [],
  stat_changes: {},
  memory: {},
  clock: { days_passed: 0 },
  dead: false,
  summary: 'A journey began.',
  score: 20,
  epitaph: 'A brave explorer.',
  highlights: [],
  inherit: { name: 'Memory', grade: 'F', desc: 'Remember the journey.' },
};
let s, url, models, prompts, built;
// the real page, built once and served as the download serves it
test.beforeAll(async () => {
  built = tempDir();
  writeFileSync(join(built, 'page.html'), (await buildPage()).html);
});
test.afterAll(() => rmSync(built, { recursive: true, force: true }));
test.beforeEach(async () => {
  models = [];
  prompts = [];
  s = await openServer({
    pageFile: join(built, 'page.html'),
    fetcher: async (_, { body }) => {
      const request = JSON.parse(body);
      models.push(request.model);
      prompts.push(request.messages[0].content);
      const array = request.messages[0].content.includes('JSON array');
      return Response.json({
        model: 'mock-model',
        choices: [{ message: { content: JSON.stringify(array ? ['a', 'b'] : reply) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    },
  });
  url = s.url;
});
test.afterEach(() => s.stop());
test.use({ locale: 'en-US' });

async function configure(page, extra = {}) {
  await page.goto(url);
  await page.locator('#nm').waitFor();
  await expect(page.locator('#noSample')).toContainText('Choose an AI provider');
  await page.evaluate(() => DR.openSettingsSheet());
  await page.selectOption('#apiProvider', 'custom');
  await page.fill('#apiEndpoint', 'https://example.com/v1');
  await page.fill('#apiModel', 'mock-model');
  if (extra.summary) await page.fill('#apiSummary', extra.summary);
  await page.fill('#apiKey', 'test-secret-never-export');
  await page.click('#apiSave');
  await expect(page.locator('#apiStatus')).toHaveText('Connection saved.');
  await expect(page.locator('#noSample')).toBeHidden();
  await page.evaluate(() => DR.closeSheet());
}

test('saves live on the server: they survive a reload and export/import without the key', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await configure(page);
  expect(await page.evaluate(() => DR.host().id)).toBe('standalone');
  await startLife(page, { name: 'Explorer', wait: 100 });
  await expect.poll(() => page.evaluate(() => DR.app.turns.some(t => t.kind === 'ai'))).toBe(true);
  await page.evaluate(() => DR.send('Look around'));
  const saved = await page.evaluate(() => ({ id: DR.app.currentSave.id, turns: DR.app.turns.length }));
  await page.reload();
  await expect.poll(() => page.evaluate(() => DR.app.currentSave?.id)).toBe(saved.id);
  await expect.poll(() => page.evaluate(() => DR.app.turns.length)).toBe(saved.turns);
  // the key stayed on the server: kept across the reload, never handed to the page
  expect(s.readJson('connection.json').profiles['Profile 1'].apiKey).toBe('test-secret-never-export');
  expect(await page.content()).not.toContain('test-secret');
  await page.evaluate(() => DR.openSettingsSheet());
  await expect(page.locator('#apiKey')).toHaveAttribute('placeholder', /Saved on this computer/);
  await expect(page.locator('#apiModel')).toHaveValue('mock-model');
  await page.evaluate(() => DR.closeSheet());
  const downloadEvent = page.waitForEvent('download');
  await page.evaluate(id => DR.exportSaveFile(id), saved.id);
  const bytes = readFileSync(await (await downloadEvent).path()).toString();
  const unpacked = await page.evaluate(async text => {
    const f = JSON.parse(text);
    return JSON.stringify(await DR.gunzipBytes(DR.z85dec(f.d).slice(0, f.n)));
  }, bytes);
  expect(unpacked).not.toContain('test-secret');
  await page.evaluate(text => DR.importSaveFile(new File([text], 'save.json', { type: 'application/json' })), bytes);
  expect(await page.evaluate(() => DR.app.saves.length)).toBe(2);
  expect(errors).toEqual([]);
});

test('images survive a reload and are embedded in story exports', async ({ page }) => {
  await configure(page);
  await startLife(page, { name: 'Portrait', wait: 100 });
  await expect.poll(() => page.evaluate(() => DR.app.turns.some(t => t.kind === 'ai'))).toBe(true);
  const id = await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 4;
    cv.getContext('2d').fillRect(0, 0, 4, 4);
    const blob = await new Promise(resolve => cv.toBlob(resolve));
    return (await DR.platform.assets.upload(blob, { type: 'image/png' })).id;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => DR.app.turns.length)).toBeGreaterThan(0);
  expect(await page.evaluate(async id => (await fetch(DR.imgUrl(id))).headers.get('content-type'), id)).toBe(
    'image/png',
  );
  await page.evaluate(async id => {
    DR.app.images.push({ id, kind: 'scene', name: 'test', tags: [] });
    const t = DR.app.turns.find(t => t.kind === 'ai');
    t.img = { scene: id };
    await DR.turnStore.update(t);
  }, id);
  const downloadEvent = page.waitForEvent('download');
  await page.evaluate(() => DR.exportStory(DR.app.currentSave.id, 'html', 'all', true, () => {}));
  const html = readFileSync(await (await downloadEvent).path()).toString();
  expect(/data:image\/(webp|jpeg|png)/.test(html)).toBe(true);
  expect(html).not.toContain('test-secret');
});

test('Fast uses the summary model, and summaries and Life Reviews work', async ({ page }) => {
  await configure(page, { summary: 'mock-summary' });
  await startLife(page, { name: 'Reviewer', wait: 100 });
  await expect.poll(() => page.evaluate(() => DR.app.turns.some(t => t.kind === 'ai'))).toBe(true);
  await page.evaluate(() => DR.platform.sample('Say ok', { modelTier: 'quick', cache: false }));
  expect(models.at(-1)).toBe('mock-summary');
  expect(await page.evaluate(() => DR.platform.sample.json('Reply with only a JSON array of tags.'))).toEqual([
    'a',
    'b',
  ]);
  await page.evaluate(async () => {
    const turns = DR.app.turns,
      next = DR.app.state.next;
    DR.app.turns = Array.from({ length: 80 }, (_, i) => ({
      i,
      kind: 'ai',
      out: { narration: 'A long story. '.repeat(120) },
    }));
    DR.app.state.next = 80;
    DR.app.state.summarizedUpto = -1;
    await DR.maybeSummarize();
    DR.app.turns = turns;
    DR.app.state.next = next;
  });
  expect(await page.evaluate(() => DR.app.state.summaries.length)).toBeGreaterThan(0);
  await page.evaluate(async () => {
    DR.app.state.dead = true;
    await DR.persist();
    await DR.runLedger();
  });
  expect(await page.evaluate(() => DR.app.turns.some(t => t.kind === 'ledger'))).toBe(true);
  expect(await page.evaluate(() => DR.app.state.pastLives.length)).toBe(1);
});

test('server settings are edited from ⚙ and kept in config.json', async ({ page }) => {
  await configure(page);
  await page.evaluate(() => DR.openSettingsSheet());
  await page.locator('summary', { hasText: 'Server settings' }).click();
  await expect(page.locator('#srvPort')).toHaveValue('3000');
  await expect(page.locator('#srvNow')).toContainText(new URL(url).port);
  await expect(page.locator('#srvHint')).toContainText('tailscale serve --bg');
  await page.fill('#srvHosts', 'my-pc.tail1234.ts.net');
  await page.click('#srvSave');
  await expect(page.locator('#srvStatus')).toContainText('Saved');
  expect(s.readJson('config.json').hosts).toEqual(['my-pc.tail1234.ts.net']);
});

test('several connection profiles: the one chosen narrates, and one can be deleted', async ({ page }) => {
  await configure(page);
  const ask = () => page.evaluate(() => DR.platform.sample('Say ok', { cache: false }));
  await page.evaluate(() => DR.openSettingsSheet());
  await page.selectOption('#apiProfile', '');
  await expect(page.locator('#apiName')).toHaveValue('Profile 2');
  await page.fill('#apiName', 'Local');
  await page.selectOption('#apiProvider', 'ollama');
  await page.fill('#apiModel', 'local-model');
  await page.click('#apiSave');
  await expect(page.locator('#apiStatus')).toHaveText('Connection saved.');
  await expect(page.locator('#apiProfile')).toHaveValue('Local');
  await ask();
  expect(models.at(-1)).toBe('local-model');
  await page.selectOption('#apiProfile', 'Profile 1');
  await expect(page.locator('#apiStatus')).toHaveText('Using Profile 1.');
  await expect(page.locator('#apiModel')).toHaveValue('mock-model');
  await ask();
  expect(models.at(-1)).toBe('mock-model');
  await page.selectOption('#apiProfile', 'Local');
  await page.click('#apiDelete');
  await expect(page.locator('#apiDelete')).toHaveText('Delete Local? Press again.');
  await page.click('#apiDelete');
  await expect(page.locator('#apiProfile option')).toHaveText(['Profile 1', '+ New profile']);
  await ask();
  expect(models.at(-1)).toBe('mock-model');
});

test('a provider with recommended models fills the first one, its summary model and token limit', async ({ page }) => {
  await page.goto(url);
  await page.locator('#nm').waitFor();
  await page.evaluate(() => DR.openSettingsSheet());
  const pick = model => page.click(`#apiPresets button[data-model="${model}"]`);
  await page.selectOption('#apiProvider', 'anthropic');
  await expect(page.locator('#apiModel')).toHaveValue('claude-opus-5-5');
  await expect(page.locator('#apiSummary')).toHaveValue('claude-haiku-5-5');
  await expect(page.locator('#apiMax')).toHaveValue('32768');
  // the Azure version shows only for Azure
  await expect(page.locator('#apiVersion')).toBeHidden();
  await page.selectOption('#apiProtocol', 'azure');
  await expect(page.locator('#apiVersion')).toBeVisible();
  await page.selectOption('#apiProtocol', 'anthropic');
  await expect(page.locator('#apiVersion')).toBeHidden();
  await expect(page.locator('#apiPresets button')).toHaveText([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
  ]);
  // a model picked from the buttons moves the token limit while it is still a stock value
  await pick('claude-haiku-5-5');
  await expect(page.locator('#apiModel')).toHaveValue('claude-haiku-5-5');
  await expect(page.locator('#apiMax')).toHaveValue('16384');
  // a limit the player chose stays
  await page.evaluate(() => (document.querySelector('#apiMax').value = '20000'));
  await pick('claude-sonnet-5-5');
  await expect(page.locator('#apiModel')).toHaveValue('claude-sonnet-5-5');
  await expect(page.locator('#apiMax')).toHaveValue('20000');
  // a provider with no recommendations starts empty and has no buttons; the player's limit survives the switch
  await page.selectOption('#apiProvider', 'ollama');
  await expect(page.locator('#apiModel')).toHaveValue('');
  await expect(page.locator('#apiPresets button')).toHaveCount(0);
  await expect(page.locator('#apiMax')).toHaveValue('20000');
  await page.selectOption('#apiProvider', 'anthropic');
  await expect(page.locator('#apiMax')).toHaveValue('20000');
  // a stock limit does not follow the player to a provider that has no use for it
  await page.evaluate(() => (document.querySelector('#apiMax').value = '32768'));
  await page.selectOption('#apiProvider', 'openai');
  await expect(page.locator('#apiMax')).toHaveValue('16384');
  // a model typed by hand fires the same change, and a summary model that is already there stays
  await page.selectOption('#apiProvider', 'anthropic');
  await page.fill('#apiSummary', 'my-summary');
  await page.fill('#apiModel', 'claude-sonnet-5-5');
  await page.locator('#apiModel').dispatchEvent('change');
  await expect(page.locator('#apiSummary')).toHaveValue('my-summary');
  await expect(page.locator('#apiMax')).toHaveValue('32768');
});

test('a ticked library note reaches the narrator through the server, and the library stays on it', async ({ page }) => {
  await configure(page);
  await startLife(page, { name: 'Reader', wait: 100 });
  await expect.poll(() => page.evaluate(() => DR.app.turns.some(t => t.kind === 'ai'))).toBe(true);
  await page.click('[data-tab="memory"]');
  const text = '## House rules\n- STANDALONE-NOTE: the inn is always open.';
  await page.setInputFiles('#noteLib [data-lib-upload]', [
    { name: 'Scenario.md', mimeType: 'text/markdown', buffer: Buffer.from(text) },
    { name: 'Other.md', mimeType: 'text/markdown', buffer: Buffer.from('OTHER-NOTE') },
  ]);
  await expect.poll(() => page.evaluate(() => (DR.app.notes || []).length)).toBe(2);
  const id = await page.evaluate(() => DR.noteByName('Scenario').id);
  await page.check(`[data-lib-use="${id}"]`);
  await expect.poll(() => page.evaluate(() => DR.app.state.noteIds)).toEqual([id]);
  await page.evaluate(() => DR.send('Look around'));
  const turn = prompts.find(p => p.includes('Look around') && p.includes('[This input]'));
  expect(turn).toContain(`[Note: Scenario]\n${text}`);
  expect(turn).not.toContain('OTHER-NOTE');
  // the server keeps the library and the pick: a reload reads both back
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => DR.app.notes && DR.app.notes.map(n => n.name)))
    .toEqual(['Other', 'Scenario']);
  expect(await page.evaluate(() => DR.app.state.noteIds)).toEqual([id]);
});

test('the image list the game saves for copies comes back intact', async ({ page }) => {
  await configure(page);
  const back = await page.evaluate(async () => {
    const blob = new Blob([JSON.stringify({ kind: 'dr-image-manifest', images: [] })], { type: 'application/json' });
    const { id } = await DR.platform.assets.upload(blob, { type: 'application/json' });
    return (await fetch(DR.imgUrl(id))).json();
  });
  expect(back).toEqual({ kind: 'dr-image-manifest', images: [] });
});

test('a page opened before the server restarted is told to reload, and its upload stops at once', async ({ page }) => {
  await configure(page);
  await page.click('[data-tab="images"]');
  await page.waitForSelector('#upl', { state: 'attached' });
  const files = await page.evaluate(
    `(${DRAW})(${JSON.stringify([...Array(10)].map((_, i) => [`bg_x${i}_day.png`, i * 30, 120, 70]))})`,
  );
  const before = models.length;
  await page.evaluate(() => {
    window.DR_SERVER_TOKEN = 'from-an-earlier-start'; // what a restart leaves this page holding
    window.__uploads = 0;
    const f = window.fetch;
    window.fetch = (u, ...a) => {
      if (String(u).includes('/api/assets/upload')) window.__uploads++;
      return f(u, ...a);
    };
  });
  await page.evaluate(`(${PICK_FILES})(${JSON.stringify(files)})`);
  await page.locator('.upl-failed').waitFor({ timeout: 30000 });
  const lines = (await page.locator('.upl-failed').textContent()).split('\n').filter(Boolean);
  expect(lines.length, 'only the pictures already on their way failed').toBeLessThanOrEqual(3);
  for (const l of lines) expect(l).toContain('The server restarted after this page opened. Reload the page.');
  expect(await page.evaluate(() => window.__uploads), 'one try each, and no more pictures sent').toBe(lines.length);
  expect(await page.evaluate(() => DR.app.images.length)).toBe(0);
  expect(models.length, 'no model was called').toBe(before);
});
