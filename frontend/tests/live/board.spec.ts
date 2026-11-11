import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type Response } from '@playwright/test';
import type { Board, Card } from '../../src/lib/api';

const user = (suffix: 'A' | 'B') => process.env[`KANBAN_LIVE_USER_${suffix}`]!.trim().toLowerCase();
const ticket = (page: Page, id: string) => page.locator(`[data-ticket-id="${id}"]`);
const matches = (method: string, path: string) => (response: Response) =>
  response.request().method() === method && new URL(response.url()).pathname === path;

async function login(page: Page, suffix: 'A' | 'B', recovery = false) {
  if (!recovery) await page.goto('/login');
  // No password in a locator action's failure log or a retained browser trace.
  await page.evaluate(({ username, password, recovery }) => {
    const form = document.querySelector<HTMLFormElement>(recovery ? '#session-form' : '.login-form')!;
    (form.elements.namedItem('username') as HTMLInputElement).value = username;
    (form.elements.namedItem('password') as HTMLInputElement).value = password;
    form.requestSubmit();
  }, { username: user(suffix), password: process.env[`KANBAN_LIVE_PASSWORD_${suffix}`]!, recovery });
  await expect(page.locator('#current-user')).toHaveText(user(suffix));
  await expect(page.locator('#new-card')).toBeEnabled();
}

async function refresh(page: Page) {
  const response = page.waitForResponse(matches('GET', '/api/cards'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await response).status()).toBe(200);
  await expect(page.locator('#board-status')).toHaveText('Up to date.');
}

async function open(page: Page, id: string) {
  const card = ticket(page, id);
  if (await card.getAttribute('open') === null) await card.locator('summary').click();
  await card.locator('[data-edit]').click();
  await expect(page.locator('#card-dialog')).toBeVisible();
}

async function save(page: Page, id: string, status = 200) {
  const response = page.waitForResponse(matches('PATCH', `/api/cards/${id}`));
  await page.getByRole('button', { name: 'Save ticket', exact: true }).click();
  expect((await response).status()).toBe(status);
  await expect(page.locator('#new-card')).toBeEnabled();
  if (status === 200) await expect(page.locator('#editor-status')).toHaveText('Ticket saved.');
  else await expect(page.locator('#content-conflict')).toBeVisible();
}

test('live cookies, two-session conflicts, retained drafts and persisted manual ordering', async ({ browser, baseURL }, testInfo) => {
  // APIRequestContext is a non-browser client and must supply Origin explicitly.
  const originHeaders = { Origin: new URL(baseURL!).origin };
  const marker = `live-${randomUUID().slice(0, 18)}`;
  console.info(`Live acceptance run: ${marker}`);
  const contextA = await browser.newContext({ baseURL });
  const contextB = await browser.newContext({ baseURL });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const created: string[] = [];
  const cleanupIssues: string[] = [];
  try {
    await login(a, 'A');
    await login(b, 'B');
    const cookies = await contextA.cookies();
    const auth = cookies.find(cookie => cookie.name === 'access_token');
    expect(Boolean(auth?.httpOnly && auth.sameSite === 'Lax' && auth.path === '/')).toBe(true);

    // All writes below target cards created by this run. No fixtures or seeded accounts.
    for (const name of ['first', 'second']) {
      await a.getByRole('button', { name: 'New ticket', exact: true }).click();
      await a.getByLabel('Title', { exact: true }).fill(`${marker} ${name}`);
      await a.getByLabel('Tag', { exact: true }).fill(marker);
      const response = a.waitForResponse(matches('POST', '/api/cards'));
      await a.getByRole('button', { name: 'Save ticket', exact: true }).click();
      const result = await response;
      expect(result.status()).toBe(201);
      const card: Card = await result.json();
      created.push(card.id);
      expect(card).toMatchObject({ creator: user('A'), column: 'review', health: 'healthy', tag: marker });
      await expect(ticket(a, card.id)).toBeVisible();
      await expect(a.locator('#new-card')).toBeEnabled();
      await a.getByRole('button', { name: 'Close ticket', exact: true }).click();
    }
    const [first, second] = created;
    await refresh(b);
    await open(a, first);
    await open(b, first);
    await a.getByLabel('Title', { exact: true }).fill(`${marker} retained title`);
    await a.getByLabel('Add a comment').fill('Unsaved discussion draft');
    await b.getByLabel('Description', { exact: true }).fill('Saved in the second session');
    await save(b, first);

    // A real background poll observes B's save, without changing A's draft.
    await expect(a.locator('#content-conflict')).toBeVisible({ timeout: 25_000 });
    await expect(a.getByLabel('Title', { exact: true })).toHaveValue(`${marker} retained title`);
    await expect(a.getByLabel('Add a comment')).toHaveValue('Unsaved discussion draft');
    await a.getByRole('button', { name: 'Keep my changes against latest' }).click();
    await expect(a.getByLabel('Description', { exact: true })).toHaveValue('Saved in the second session');
    await save(a, first);

    // Real stale HTTP write: change B after A has rebased, immediately before A's PATCH.
    await a.getByLabel('Title', { exact: true }).fill(`${marker} stale draft`);
    await a.route(`**/api/cards/${first}`, async route => {
      if (route.request().method() === 'PATCH') {
        const latest: Card = await (await contextB.request.get(`/api/cards/${first}`)).json();
        const changed = await contextB.request.patch(`/api/cards/${first}`, { headers: originHeaders,
          data: { expected_version: latest.version, description: 'Concurrent save at request time' },
        });
        expect(changed.status()).toBe(200);
      }
      await route.continue(); // FastAPI supplies the actual 409, never a fixture response.
    }, { times: 1 });
    await save(a, first, 409);
    await expect(a.getByLabel('Title', { exact: true })).toHaveValue(`${marker} stale draft`);
    await a.getByRole('button', { name: 'Keep my changes against latest' }).click();
    await save(a, first);

    // Comment activity must not invalidate an open content save.
    await a.getByLabel('Description', { exact: true }).fill('Content alongside discussion');
    await b.getByLabel('Add a comment').fill('Comment from the second account');
    const commentResponse = b.waitForResponse(matches('POST', `/api/cards/${first}/comments`));
    await b.getByRole('button', { name: 'Add comment', exact: true }).click();
    expect((await commentResponse).status()).toBe(201);
    await refresh(a);
    await expect(a.locator('#comments')).toContainText('Comment from the second account');
    await expect(a.getByRole('button', { name: 'Edit comment', exact: true })).toHaveCount(0);
    await expect(a.getByLabel('Add a comment')).toHaveValue('Unsaved discussion draft');
    await save(a, first);

    // Offline refresh and a genuinely revoked token retain both tab-memory drafts.
    await a.getByLabel('Title', { exact: true }).fill('Draft through network and session recovery');
    await contextA.setOffline(true);
    await a.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
    await expect(a.locator('#board-status')).toContainText('Last successful data is retained');
    await expect(a.getByLabel('Title', { exact: true })).toHaveValue('Draft through network and session recovery');
    await contextA.setOffline(false);
    expect((await contextA.request.post('/api/auth/logout', { headers: originHeaders })).status()).toBe(204);
    await a.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
    await expect(a.locator('#session-dialog')).toBeVisible();
    await login(a, 'A', true);
    await expect(a.locator('#session-dialog')).toBeHidden();
    await expect(a.getByLabel('Title', { exact: true })).toHaveValue('Draft through network and session recovery');
    await expect(a.getByLabel('Add a comment')).toHaveValue('Unsaved discussion draft');
    await save(a, first);

    // Race another real move against A's observed ordering, without changing A's card.
    await a.route(`**/api/cards/${first}/move`, async route => {
      const board: Board = await (await contextB.request.get('/api/cards')).json();
      const neighbor = board.cards.find(card => card.id === second)!;
      const changed = await contextB.request.post(`/api/cards/${second}/move`, { headers: originHeaders,
        data: { column: 'review', before_card_id: null, expected_version: neighbor.version, expected_order_versions: board.order_versions },
      });
      expect(changed.status()).toBe(200);
      await route.continue();
    }, { times: 1 });
    const staleMove = a.waitForResponse(matches('POST', `/api/cards/${first}/move`));
    await a.locator('#editor-column').selectOption('blocked');
    const rejected = await staleMove;
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error.code).toBe('order_conflict');
    await expect(a.locator('#editor-status')).toContainText('Another save');
    await expect(a.locator('#editor-column')).toHaveValue('review');

    // Selector movement and health persist through the live database.
    for (const column of ['blocked', 'review']) {
      const response = a.waitForResponse(matches('POST', `/api/cards/${first}/move`));
      await a.locator('#editor-column').selectOption(column);
      expect((await response).status()).toBe(200);
      await expect(a.locator('#editor-status')).toHaveText('Ticket moved.');
      await expect(a.locator('[name="health"]')).toHaveValue('blocked');
    }
    await a.getByRole('button', { name: 'Close ticket', exact: true }).click();
    await refresh(a);
    const moveResponse = a.waitForResponse(matches('POST', `/api/cards/${first}/move`));
    await ticket(a, first).locator('summary').dragTo(ticket(a, second).locator('summary'), { targetPosition: { x: 30, y: 1 } });
    const moved = await moveResponse;
    expect(moved.status()).toBe(200);
    expect(moved.request().postDataJSON().before_card_id).toBe(second);
    await expect(a.locator('#new-card')).toBeEnabled();
    const persisted: Board = await (await contextA.request.get('/api/cards')).json();
    const order = persisted.cards.filter(card => card.column === 'review').map(card => card.id);
    expect(order.indexOf(first) + 1).toBe(order.indexOf(second));
    for (const page of [a, b]) {
      await page.reload();
      await expect(page.locator('#new-card')).toBeEnabled();
      expect(await page.locator('[data-column="review"] .ticket').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.ticketId))).toEqual(order);
      await open(page, first);
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Draft through network and session recovery');
      await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Content alongside discussion');
      await expect(page.locator('#comments')).toContainText('Comment from the second account');
      // Unsaved comment drafts are intentionally discarded by navigation/reload.
      await expect(page.getByLabel('Add a comment')).toHaveValue('');
    }
  } finally {
    await contextA.setOffline(false);
    // Remove only known run-owned tickets; never drop/reset databases or rewrite counters.
    for (const id of created) {
      try {
        const response = await contextB.request.get(`/api/cards/${id}`);
        if (response.status() === 404) continue;
        if (response.status() !== 200) throw new Error('Cleanup read failed');
        const card: Card = await response.json();
        if (card.tag !== marker || card.creator !== user('A')) throw new Error('Ownership marker changed');
        const deleted = await contextB.request.delete(`/api/cards/${id}?expected_version=${card.version}&expected_comments_version=${card.comments_version}`, { headers: originHeaders });
        if (deleted.status() !== 204) throw new Error('Guarded cleanup failed');
      } catch { cleanupIssues.push(id); }
    }
    for (const context of [contextA, contextB]) {
      try { await context.request.post('/api/auth/logout', { headers: originHeaders }); } catch { /* Session expires normally if unavailable. */ }
      await context.close();
    }
    testInfo.annotations.push({ type: 'live-run', description: `${marker}; created IDs: ${created.join(', ') || 'none'}` });
    if (cleanupIssues.length) throw new Error(`Live acceptance cleanup needs manual review for run ${marker}, card IDs: ${cleanupIssues.join(', ')}. No cleanup was retried.`);
  }
});

test('live comment ownership, stale edits, uncertain responses, cap and guarded deletion', async ({ browser, baseURL }) => {
  // APIRequestContext is a non-browser client and must supply Origin explicitly.
  const originHeaders = { Origin: new URL(baseURL!).origin };
  const marker = `live-${randomUUID().slice(0, 18)}`;
  console.info(`Live discussion run: ${marker}`);
  const contextA = await browser.newContext({ baseURL });
  const contextB = await browser.newContext({ baseURL });
  const authorSession = await browser.newContext({ baseURL });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const other = await authorSession.newPage();
  let id: string | undefined;
  let cleanupIssue = false;
  try {
    await login(a, 'A');
    await login(b, 'B');
    await login(other, 'A');
    await a.getByRole('button', { name: 'New ticket', exact: true }).click();
    await a.getByLabel('Title', { exact: true }).fill(`${marker} discussion`);
    await a.getByLabel('Tag', { exact: true }).fill(marker);
    const created = a.waitForResponse(matches('POST', '/api/cards'));
    await a.getByRole('button', { name: 'Save ticket', exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    const initial: Card = await createResponse.json();
    id = initial.id;
    await expect(a.locator('#new-card')).toBeEnabled();
    await a.getByLabel('Add a comment').fill('Original author comment');
    const added = a.waitForResponse(matches('POST', `/api/cards/${id}/comments`));
    await a.getByRole('button', { name: 'Add comment', exact: true }).click();
    const commentResponse = await added;
    expect(commentResponse.status()).toBe(201);
    const withComment: Card = await commentResponse.json();
    const commentId = withComment.comments[0].id;
    const path = `/api/cards/${id}/comments/${commentId}`;
    await expect(a.locator('#new-card')).toBeEnabled();
    await refresh(b);
    await open(b, id);
    await expect(b.getByRole('button', { name: 'Edit comment', exact: true })).toHaveCount(0);
    const forbidden = await contextB.request.patch(path, { headers: originHeaders, data: { text: 'Forbidden edit', expected_comment_version: 1 } });
    expect(forbidden.status()).toBe(403);
    const unchanged: Card = await (await contextB.request.get(`/api/cards/${id}`)).json();
    expect(unchanged.comments).toEqual(withComment.comments);
    expect(unchanged.comments_version).toBe(withComment.comments_version);

    await a.getByRole('button', { name: 'Edit comment', exact: true }).click();
    await a.getByLabel('Edit comment', { exact: true }).fill('Retained author draft');
    await a.route(`**${path}`, async route => {
      const changed = await authorSession.request.patch(path, { headers: originHeaders, data: { text: 'Another author session saved', expected_comment_version: 1 } });
      expect(changed.status()).toBe(200);
      await route.continue();
    }, { times: 1 });
    const conflicted = a.waitForResponse(matches('PATCH', path));
    await a.getByRole('button', { name: 'Save comment', exact: true }).click();
    expect((await conflicted).status()).toBe(409);
    await expect(a.getByRole('button', { name: 'Keep my text against latest' })).toBeVisible();
    await expect(a.getByLabel('Edit comment', { exact: true })).toHaveValue('Retained author draft');
    await a.getByRole('button', { name: 'Keep my text against latest' }).click();
    const edited = a.waitForResponse(matches('PATCH', path));
    await a.getByRole('button', { name: 'Save comment', exact: true }).click();
    const editResponse = await edited;
    expect(editResponse.status()).toBe(200);
    const editedCard: Card = await editResponse.json();
    expect(editedCard.version).toBe(initial.version);
    expect(editedCard.comments[0]).toMatchObject({ version: 3, text: 'Retained author draft' });
    await expect(a.locator('#new-card')).toBeEnabled();

    // Commit to MongoDB, then lose only the browser response. No synthetic API data.
    let commentPosts = 0;
    a.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/cards/${id}/comments`) commentPosts++;
    });
    await a.route(`**/api/cards/${id}/comments`, async route => {
      const committed = await route.fetch({ maxRetries: 0 });
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    }, { times: 1 });
    await a.getByLabel('Add a comment').fill('Committed despite lost response');
    await a.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(a.locator('#editor-status')).toContainText('outcome is uncertain');
    await expect(a.locator('#comments')).toContainText('Committed despite lost response');
    await expect(a.getByLabel('Add a comment')).toHaveValue('Committed despite lost response');
    expect(commentPosts).toBe(1);
    a.once('dialog', dialog => dialog.dismiss());
    await a.getByRole('button', { name: 'Add comment', exact: true }).click();
    expect(commentPosts).toBe(1);
    // Confirm inspection, then deliberately save unrelated content instead of duplicating the comment.
    await a.getByLabel('Title', { exact: true }).fill(`${marker} response reviewed`);
    a.once('dialog', dialog => dialog.accept());
    await save(a, id);
    await a.getByLabel('Add a comment').fill('');

    for (let i = 2; i < 20; i++) {
      const response = await contextB.request.post(`/api/cards/${id}/comments`, { headers: originHeaders, data: { text: `Cap check ${i}` } });
      expect(response.status()).toBe(201);
    }
    await refresh(a);
    await expect(a.locator('#discussion-heading')).toHaveText('Comments (20/20)');
    await expect(a.getByRole('button', { name: 'Add comment', exact: true })).toBeDisabled();
    const overflow = await contextB.request.post(`/api/cards/${id}/comments`, { headers: originHeaders, data: { text: 'Over capacity' } });
    expect(overflow.status()).toBe(422);
    expect((await overflow.json()).error.code).toBe('comment_limit_reached');
    const owned = a.locator(`[data-comment="${commentId}"]`);
    a.once('dialog', dialog => dialog.accept());
    const deletedComment = a.waitForResponse(matches('DELETE', path));
    await owned.getByRole('button', { name: 'Delete comment', exact: true }).click();
    expect((await deletedComment).status()).toBe(200);
    await expect(a.getByRole('button', { name: 'Add comment', exact: true })).toBeEnabled();
    await a.getByLabel('Add a comment').fill('Freed slot reused');
    await a.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(a.locator('#discussion-heading')).toHaveText('Comments (20/20)');

    // Another user's discussion update between confirmation and DELETE must prevent removal.
    await a.route(url => url.pathname === `/api/cards/${id}`, async route => {
      const current: Card = await (await contextB.request.get(`/api/cards/${id}`)).json();
      const comment = current.comments.find(item => item.author === user('B'))!;
      const update = await contextB.request.patch(`/api/cards/${id}/comments/${comment.id}`, { headers: originHeaders,
        data: { text: 'Discussion updated before deletion', expected_comment_version: comment.version },
      });
      expect(update.status()).toBe(200);
      await route.continue();
    }, { times: 1 });
    const rejectedDelete = a.waitForResponse(matches('DELETE', `/api/cards/${id}`));
    a.once('dialog', dialog => dialog.accept());
    await a.getByRole('button', { name: 'Delete ticket', exact: true }).click();
    expect((await rejectedDelete).status()).toBe(409);
    await expect(a.locator('#comments')).toContainText('Discussion updated before deletion');
    await expect(a.locator('#editor-status')).toContainText('Another save');
    const acceptedDelete = a.waitForResponse(matches('DELETE', `/api/cards/${id}`));
    a.once('dialog', dialog => dialog.accept());
    await a.getByRole('button', { name: 'Delete ticket', exact: true }).click();
    expect((await acceptedDelete).status()).toBe(204);
    await expect(a.locator('#card-dialog')).toBeHidden();
    expect((await contextB.request.get(`/api/cards/${id}`)).status()).toBe(404);
    await b.reload();
    await expect(b.locator('#new-card')).toBeEnabled();
    await expect(ticket(b, id)).toHaveCount(0);
  } finally {
    if (id) {
      try {
        const response = await contextB.request.get(`/api/cards/${id}`);
        if (response.status() !== 404) {
          if (response.status() !== 200) throw new Error('Cleanup read failed');
          const card: Card = await response.json();
          if (card.tag !== marker || card.creator !== user('A')) throw new Error('Ownership marker changed');
          const deleted = await contextB.request.delete(`/api/cards/${id}?expected_version=${card.version}&expected_comments_version=${card.comments_version}`, { headers: originHeaders });
          if (deleted.status() !== 204) throw new Error('Guarded cleanup failed');
        }
      } catch { cleanupIssue = true; }
    }
    for (const context of [contextA, contextB, authorSession]) {
      try { await context.request.post('/api/auth/logout', { headers: originHeaders }); } catch { /* Only these test sessions. */ }
      await context.close();
    }
    if (cleanupIssue) throw new Error(`Manual cleanup review required: run ${marker}, card ${id}.`);
  }
});
