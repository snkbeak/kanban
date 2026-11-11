import { test, expect, type Page, type Route } from '@playwright/test';
import type { Board, Card, Comment, Column } from '../../src/lib/api';

const timestamp = '2026-10-20T12:00:00Z';
const makeCard = (id = 'a', overrides: Partial<Card> = {}): Card => ({
  id, ticket_number: id === 'a' ? 1 : 2, title: id === 'a' ? 'First ticket' : 'Second ticket',
  description: 'Plain text details', tag: 'feature', column: 'review', position: id === 'a' ? 0 : 1,
  difficulty: 'medium', health: 'healthy', assignees: ['chris'], creator: 'chris',
  created_at: timestamp, updated_at: timestamp, version: 1, comments_version: 0, comments: [], ...overrides,
});
const makeComment = (id: string, author = 'chris'): Comment => ({ id, author, text: `${author}'s comment`, version: 1, created_at: timestamp, updated_at: timestamp });
type Call = { method: string; path: string; body: any };

// Isolated HTTP fixtures exercise the shipped browser code, never the application DB.
async function backend(page: Page, cards = [makeCard(), makeCard('b')]) {
  const fixture = {
    board: { cards, order_versions: { review: 2, backlog: 0, in_progress: 0, done: 0, blocked: 0 } } as Board,
    calls: [] as Call[], signedIn: true, username: 'chris', uncertainComment: false,
    failReads: false, conflictDelete: false, conflictMove: false, failNextComment: 0,
    loginRetryAfter: 0, rejectOrigins: false,
    pendingRead: null as null | (() => Promise<void>), holdRead: false,
  };
  const error = (route: Route, status: number, code: string) => route.fulfill({ status, json: { error: { code, message: code, fields: [] } } });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');
    const method = request.method();
    const body = request.postDataJSON();
    fixture.calls.push({ path: url.pathname + url.search, method, body });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      // Validate the real browser's automatic header on every fixture mutation.
      expect(await request.headerValue('origin')).toBe(new URL(request.url()).origin);
      if (fixture.rejectOrigins) return error(route, 403, 'csrf_rejected');
    }
    if (path === '/auth/login') {
      if (fixture.loginRetryAfter) return route.fulfill({ status: 429,
        headers: { 'Retry-After': String(fixture.loginRetryAfter) },
        json: { error: { code: 'login_throttled', message: 'Too many login attempts', fields: [] } },
      });
      if (body.password !== 'password123') return error(route, 401, 'unauthenticated');
      fixture.username = body.username.trim().toLowerCase(); fixture.signedIn = true;
      return route.fulfill({ json: { username: fixture.username } });
    }
    if (path === '/auth/logout') { fixture.signedIn = false; return route.fulfill({ status: 204 }); }
    if (!fixture.signedIn) return error(route, 401, 'unauthenticated');
    if (path === '/auth/me') return route.fulfill({ json: { username: fixture.username } });
    if (path === '/users') return route.fulfill({ json: ['chris', 'james', 'sean'].map(username => ({ username })) });
    if (path === '/cards' && method === 'GET') {
      if (fixture.failReads) return error(route, 503, 'database_unavailable');
      if (fixture.holdRead) {
        fixture.holdRead = false;
        const snapshot = structuredClone(fixture.board);
        fixture.pendingRead = () => route.fulfill({ json: snapshot }).catch(() => {});
        return;
      }
      return route.fulfill({ json: fixture.board });
    }
    if (path === '/cards' && method === 'POST') {
      const card = makeCard(`created-${fixture.calls.length}`, { ...body, ticket_number: 3, assignees: body.assignees ?? [], position: 100 });
      fixture.board.cards.push(card); fixture.board.order_versions[card.column]++;
      return route.fulfill({ status: 201, json: card });
    }
    const [, , id, operation, commentId] = path.split('/');
    const card = fixture.board.cards.find(item => item.id === id);
    if (!card) return error(route, 404, 'not_found');
    if (operation === 'move') {
      if (fixture.conflictMove) { fixture.conflictMove = false; fixture.board.order_versions[card.column]++; return error(route, 409, 'order_conflict'); }
      if (body.expected_version !== card.version) return error(route, 409, 'version_conflict');
      const column = body.column as Column;
      for (const key of new Set([card.column, column])) if (body.expected_order_versions[key] !== fixture.board.order_versions[key]) return error(route, 409, 'order_conflict');
      fixture.board.order_versions[card.column]++;
      if (column !== card.column) fixture.board.order_versions[column]++;
      fixture.board.cards = fixture.board.cards.filter(item => item.id !== card.id);
      card.column = column; card.version++;
      if (column === 'blocked') card.health = 'blocked';
      const destination = fixture.board.cards.filter(item => item.column === column);
      const index = body.before_card_id ? destination.findIndex(item => item.id === body.before_card_id) : destination.length;
      destination.splice(index, 0, card); destination.forEach((item, i) => { item.position = i; });
      fixture.board.cards = [...fixture.board.cards.filter(item => item.column !== column), ...destination];
      return route.fulfill({ json: { card, order_versions: fixture.board.order_versions } });
    }
    if (operation === 'comments') {
      if (fixture.failNextComment) { const status = fixture.failNextComment; fixture.failNextComment = 0; return error(route, status, status === 403 ? 'forbidden' : 'validation_error'); }
      if (method === 'POST') {
        if (card.comments.length >= 20) return error(route, 422, 'comment_limit_reached');
        card.comments.push({ ...makeComment(`new-${fixture.calls.length}`, fixture.username), text: body.text }); card.comments_version++;
        if (fixture.uncertainComment) { fixture.uncertainComment = false; return route.abort('failed'); }
        return route.fulfill({ status: 201, json: card });
      }
      const comment = card.comments.find(item => item.id === commentId);
      if (!comment) return error(route, 404, 'not_found');
      if (comment.author !== fixture.username) return error(route, 403, 'forbidden');
      const expected = method === 'DELETE' ? Number(url.searchParams.get('expected_comment_version')) : body.expected_comment_version;
      if (expected !== comment.version) return error(route, 409, 'version_conflict');
      if (method === 'DELETE') card.comments = card.comments.filter(item => item.id !== commentId);
      else { comment.text = body.text; comment.version++; }
      card.comments_version++;
      return route.fulfill({ json: card });
    }
    if (method === 'PATCH') {
      if (body.expected_version !== card.version) return error(route, 409, 'version_conflict');
      const { expected_version, ...content } = body;
      Object.assign(card, content); card.version++;
      return route.fulfill({ json: card });
    }
    if (method === 'DELETE') {
      if (fixture.conflictDelete) { fixture.conflictDelete = false; card.comments.push(makeComment('late', 'sean')); card.comments_version++; }
      if (Number(url.searchParams.get('expected_version')) !== card.version || Number(url.searchParams.get('expected_comments_version')) !== card.comments_version) return error(route, 409, 'version_conflict');
      fixture.board.cards = fixture.board.cards.filter(item => item.id !== id); fixture.board.order_versions[card.column]++;
      return route.fulfill({ status: 204 });
    }
    throw new Error(`Unhandled fixture request: ${method} ${path}`);
  });
  return fixture;
}
const refresh = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
async function openCard(page: Page, id = 'a') {
  await page.locator(`[data-ticket-id="${id}"] summary`).click();
  await page.locator(`[data-edit="${id}"]`).click();
  await expect(page.locator('#card-dialog')).toBeVisible();
}

test('login, restoration, generic failure and logout', async ({ page }) => {
  const fixture = await backend(page); fixture.signedIn = false;
  await page.goto('/'); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username', { exact: true }).fill('chris');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.locator('#login-status')).toContainText('Unable to log in');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.locator('#current-user')).toHaveText('chris');
  await expect(page.locator('.ticket')).toHaveCount(2);
  await page.reload(); await expect(page.locator('#current-user')).toHaveText('chris');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

for (const recovery of [false, true]) {
  test(`throttling explains retry time without replay in ${recovery ? 'session recovery' : 'login'}`, async ({ page }) => {
    const fixture = await backend(page);
    if (recovery) {
      await page.goto('/'); await expect(page.locator('#current-user')).toHaveText('chris');
      fixture.signedIn = false; await refresh(page);
      await expect(page.locator('#session-dialog')).toBeVisible();
    } else {
      fixture.signedIn = false; await page.goto('/login');
    }
    await page.clock.install();
    const form = page.locator(recovery ? '#session-form' : '.login-form');
    const status = page.locator(recovery ? '#session-status' : '#login-status');
    fixture.loginRetryAfter = 60;
    await form.locator('[name="username"]').fill('chris');
    await form.locator('[name="password"]').fill('password123');
    await form.locator('button').click();
    await expect(status).toContainText('Too many login attempts. Try again after');
    await expect(status).toContainText('in 60 seconds');
    await expect(form.locator('[name="password"]')).toHaveValue('');
    await page.clock.fastForward(61000);
    expect(fixture.calls.filter(call => call.path === '/api/auth/login')).toHaveLength(1);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    fixture.loginRetryAfter = 0;
    await form.locator('[name="password"]').fill('password123');
    await form.locator('button').click();
    await expect(page.locator('#current-user')).toHaveText('chris');
    if (recovery) await expect(page.locator('#session-dialog')).toBeHidden();
    expect(fixture.calls.filter(call => call.path === '/api/auth/login')).toHaveLength(2);
  });
}

for (const recovery of [false, true]) {
  test(`origin rejection and explicit retry in ${recovery ? 'session recovery' : 'login'}`, async ({ page }) => {
    const fixture = await backend(page);
    if (recovery) {
      await page.goto('/'); await openCard(page);
      await page.getByLabel('Title', { exact: true }).fill('Retained origin draft');
      await page.locator('#comment-form textarea').fill('Retained comment draft');
      fixture.signedIn = false; await refresh(page);
      await expect(page.locator('#session-dialog')).toBeVisible();
    } else {
      fixture.signedIn = false; await page.goto('/login');
    }
    await page.clock.install();
    fixture.rejectOrigins = true;
    const form = page.locator(recovery ? '#session-form' : '.login-form');
    await form.locator('[name="username"]').fill('chris');
    await form.locator('[name="password"]').fill('password123');
    await form.locator('button').click();
    await expect(page.locator(recovery ? '#session-status' : '#login-status')).toContainText('site origin security check');
    await expect(form.locator('[name="password"]')).toHaveValue('');
    await page.clock.fastForward(61000);
    expect(fixture.calls.filter(call => call.path === '/api/auth/login')).toHaveLength(1);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    fixture.rejectOrigins = false;
    await form.locator('[name="password"]').fill('password123');
    await form.locator('button').click();
    await expect(page.locator('#current-user')).toHaveText('chris');
    if (recovery) {
      await expect(page.locator('#session-dialog')).toBeHidden();
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Retained origin draft');
      await expect(page.locator('#comment-form textarea')).toHaveValue('Retained comment draft');
    }
    expect(fixture.calls.filter(call => call.path === '/api/auth/login')).toHaveLength(2);
  });
}

test('origin rejection preserves content, comments and session through explicit recovery and logout', async ({ page }) => {
  const fixture = await backend(page);
  await page.goto('/'); await openCard(page);
  await page.getByLabel('Title', { exact: true }).fill('Origin draft');
  await page.locator('#comment-form textarea').fill('Origin comment');
  await page.clock.install();
  fixture.rejectOrigins = true;
  await page.getByRole('button', { name: 'Save ticket' }).click();
  await expect(page.locator('#editor-status')).toContainText('site origin security check');
  await expect(page.locator('#editor-status')).not.toContainText('Only the comment author');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('#editor-status')).toContainText('Your draft is preserved');
  await page.clock.fastForward(61000);
  expect(fixture.calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
  expect(fixture.calls.filter(call => call.path === '/api/cards/a/comments')).toHaveLength(1);
  expect(fixture.board.cards[0].title).toBe('First ticket');
  expect(fixture.board.cards[0].comments).toHaveLength(0);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Origin draft');
  await expect(page.locator('#comment-form textarea')).toHaveValue('Origin comment');
  await page.keyboard.press('Escape');
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.locator('#board-status')).toContainText('site origin security check');
  await expect(page.locator('#current-user')).toHaveText('chris');
  expect(fixture.signedIn).toBe(true);
  await page.locator('[data-edit="a"]').click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Origin draft');
  await expect(page.locator('#comment-form textarea')).toHaveValue('Origin comment');
  fixture.rejectOrigins = false;
  await page.getByRole('button', { name: 'Save ticket' }).click();
  await expect(page.locator('#editor-status')).toContainText('Ticket saved.');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('#comment-form textarea')).toHaveValue('');
  expect(fixture.board.cards[0].title).toBe('Origin draft');
  expect(fixture.board.cards[0].comments[0].text).toBe('Origin comment');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(fixture.calls.filter(call => call.path === '/api/auth/logout')).toHaveLength(2);
});

test('create defaults, required tag, content edit, assignments and safe plain text', async ({ page }) => {
  const fixture = await backend(page, []);
  await page.goto('/'); await page.getByRole('button', { name: 'New ticket' }).click();
  await expect(page.locator('[name="difficulty"]')).toHaveValue('medium');
  await expect(page.locator('[name="health"]')).toHaveValue('healthy');
  await page.getByLabel('Title', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Save ticket' }).click();
  expect(fixture.calls.filter(call => call.method === 'POST' && call.path === '/api/cards')).toHaveLength(0);
  await page.getByLabel('Tag', { exact: true }).fill(' FEATURE ');
  await page.getByLabel('Description', { exact: true }).fill('Line one\nLine two');
  await page.getByRole('button', { name: 'Save ticket' }).click();
  await expect(page.locator('#editor-heading')).toHaveText('KAN-3');
  const create = fixture.calls.find(call => call.method === 'POST' && call.path === '/api/cards')!.body;
  expect(create).toMatchObject({ tag: 'feature', column: 'review', difficulty: 'medium', health: 'healthy', assignees: [] });
  await expect(page.locator('.ticket img')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'chris', exact: true }).check();
  await page.getByLabel('Description', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save ticket' }).click();
  await expect.poll(() => fixture.calls.filter(call => call.method === 'PATCH').length).toBe(1);
  expect(fixture.calls.find(call => call.method === 'PATCH')!.body).toEqual({ expected_version: 1, description: '', assignees: ['chris'] });
  await page.getByRole('button', { name: 'Close ticket' }).click();
  await page.reload(); await expect(page.locator('.ticket h3')).toHaveText('<img src=x onerror=alert(1)>');
});

test('Blocked creation, selector append, locked health and stale draft after move', async ({ page }) => {
  const fixture = await backend(page);
  await page.goto('/'); await page.getByRole('button', { name: 'New ticket' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Blocked directly');
  await page.getByLabel('Tag', { exact: true }).fill('bugfix');
  await page.locator('[name="column"]').selectOption('blocked');
  await expect(page.locator('[name="health"]')).toBeDisabled();
  await expect(page.locator('[name="health"]')).toHaveValue('blocked');
  await page.getByRole('button', { name: 'Save ticket' }).click();
  await expect(page.locator('#editor-heading')).toHaveText('KAN-3');
  expect(fixture.board.cards.find(card => card.ticket_number === 3)?.health).toBe('blocked');
  await page.getByRole('button', { name: 'Close ticket' }).click();
  await openCard(page);
  await page.getByLabel('Title', { exact: true }).fill('Draft before move');
  await expect(page.locator('#editor-column option[value="review"]')).toHaveAttribute('disabled', '');
  await page.locator('#editor-column').selectOption('blocked');
  await expect(page.locator('#content-conflict')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Draft before move');
  await expect(page.locator('[name="health"]')).toBeDisabled();
  const move = fixture.calls.find(call => call.path.endsWith('/a/move'))!.body;
  expect(move).toMatchObject({ column: 'blocked', before_card_id: null, expected_version: 1, expected_order_versions: { review: 2, blocked: 1 } });
  await page.getByRole('button', { name: 'Keep my changes against latest' }).click();
  await page.getByRole('button', { name: 'Save ticket' }).click();
  await expect(page.locator('#editor-status')).toHaveText('Ticket saved.');
  await page.locator('#editor-column').selectOption('done');
  await expect(page.locator('[name="health"]')).toBeEnabled();
  await expect(page.locator('[name="health"]')).toHaveValue('blocked');
});

test('content drafts survive independent discussion, remote conflict and explicit reapply', async ({ page }) => {
  const fixture = await backend(page);
  await page.goto('/'); await openCard(page);
  await page.getByLabel('Title', { exact: true }).fill('My draft');
  fixture.board.cards[0].comments.push(makeComment('remote', 'sean')); fixture.board.cards[0].comments_version++;
  await refresh(page); await expect(page.locator('#discussion-heading')).toHaveText('Comments (1/20)');
  await expect(page.locator('#content-conflict')).toBeHidden();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My draft');
  fixture.board.cards[0].description = 'Someone else edited this'; fixture.board.cards[0].version++;
  await refresh(page); await expect(page.locator('#content-conflict')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save ticket' })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my changes against latest' }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Someone else edited this');
  await page.getByRole('button', { name: 'Save ticket' }).click();
  await expect.poll(() => fixture.board.cards[0].title).toBe('My draft');
  expect(fixture.calls.find(call => call.method === 'PATCH')!.body).toEqual({ title: 'My draft', expected_version: 2 });
});

test('comment ownership, independent edit versions, cap and guarded whole-card deletion', async ({ page }) => {
  const fixture = await backend(page, [makeCard('a', { comments: [makeComment('own'), ...Array.from({ length: 19 }, (_, i) => makeComment(`other-${i}`, 'sean'))], comments_version: 20 })]);
  await page.goto('/'); await openCard(page);
  await expect(page.getByRole('button', { name: 'Edit comment', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit comment', exact: true }).click();
  await page.getByLabel('Edit comment', { exact: true }).fill('My revised text');
  fixture.board.cards[0].comments[0].version = 2; fixture.board.cards[0].comments[0].text = 'Other session'; fixture.board.cards[0].comments_version++;
  await refresh(page);
  await expect(page.getByRole('button', { name: 'Save comment', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Edit comment', { exact: true })).toHaveValue('My revised text');
  await page.getByRole('button', { name: 'Keep my text against latest' }).click();
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await expect(page.locator('[data-comment="own"]')).toContainText('My revised text');
  expect(fixture.board.cards[0].version).toBe(1);
  expect(fixture.calls.find(call => call.path.endsWith('/comments/own') && call.method === 'PATCH')!.body).toEqual({ text: 'My revised text', expected_comment_version: 2 });
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeEnabled();
  await page.getByLabel('Add a comment').fill('New comment');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.locator('#discussion-heading')).toHaveText('Comments (20/20)');
  fixture.conflictDelete = true;
  await page.getByRole('button', { name: 'Delete ticket', exact: true }).click();
  await expect(page.locator('#editor-status')).toContainText('Another save');
  await expect(page.locator('[data-comment="late"]')).toBeVisible();
  expect(fixture.calls.filter(call => call.method === 'DELETE' && call.path.startsWith('/api/cards/a?'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Delete ticket', exact: true }).click();
  await expect(page.locator('#card-dialog')).toBeHidden();
  await expect(page.locator('.ticket')).toHaveCount(0);
});

test('drag reorders within a column and filters disable drag while allowing selector moves', async ({ page }) => {
  const fixture = await backend(page);
  await page.goto('/'); await expect(page.locator('.ticket')).toHaveCount(2);
  await page.locator('[data-ticket-id="b"] summary').dragTo(page.locator('[data-ticket-id="a"] summary'), { targetPosition: { x: 30, y: 1 } });
  await expect.poll(() => fixture.calls.filter(call => call.path.endsWith('/move')).length).toBe(1);
  expect(fixture.calls.find(call => call.path.endsWith('/move'))!.body).toMatchObject({ column: 'review', before_card_id: 'a', expected_version: 1, expected_order_versions: { review: 2 } });
  await expect(page.locator('.ticket').first()).toHaveAttribute('data-ticket-id', 'b');
  await page.reload(); await expect(page.locator('.ticket').first()).toHaveAttribute('data-ticket-id', 'b');
  await page.getByLabel('Search tickets', { exact: true }).fill('First');
  await expect(page.locator('.ticket summary')).toHaveAttribute('draggable', 'false');
  await expect(page.locator('#board-results')).toHaveText('1 of 2 tickets across 5 columns');
  await page.locator('.ticket summary').click();
  await page.getByLabel('Move KAN-1', { exact: true }).selectOption('backlog');
  await expect(page.locator('[data-column="backlog"] .ticket')).toHaveCount(1);
});

test('uncertain comment writes refresh once, preserve drafts and require a deliberate retry', async ({ page }) => {
  const fixture = await backend(page); fixture.uncertainComment = true; fixture.failReads = false;
  await page.goto('/'); await openCard(page);
  await page.getByLabel('Add a comment').fill('May have succeeded');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.locator('#editor-status')).toContainText('outcome is uncertain');
  await expect(page.locator('#comments')).toContainText('May have succeeded');
  await expect(page.getByLabel('Add a comment')).toHaveValue('May have succeeded');
  expect(fixture.calls.filter(call => call.method === 'POST' && call.path.endsWith('/comments'))).toHaveLength(1);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  expect(fixture.calls.filter(call => call.method === 'POST' && call.path.endsWith('/comments'))).toHaveLength(1);
});

test('expired sessions preserve content and comment drafts in memory', async ({ page }) => {
  const fixture = await backend(page);
  await page.goto('/'); await openCard(page);
  await page.getByLabel('Title', { exact: true }).fill('Draft through expiry');
  await page.getByLabel('Add a comment').fill('Comment through expiry');
  fixture.signedIn = false; await refresh(page);
  await expect(page.locator('#session-dialog')).toBeVisible();
  await page.locator('#session-form [name="password"]').fill('password123');
  await page.locator('#session-form button').click();
  await expect(page.locator('#session-dialog')).toBeHidden();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Draft through expiry');
  await expect(page.getByLabel('Add a comment')).toHaveValue('Comment through expiry');
  await expect(page.locator('#current-user')).toHaveText('chris');
});

test('failed refresh retains data and drafts; mobile dialog supports Escape and focus return', async ({ page }) => {
  const fixture = await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await openCard(page);
  await page.getByLabel('Title', { exact: true }).fill('Keep this');
  fixture.failReads = true; await refresh(page);
  await expect(page.locator('#board-status')).toContainText('Last successful data is retained');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep this');
  await page.keyboard.press('Escape'); await expect(page.locator('#card-dialog')).toBeHidden();
  await expect(page.locator('[data-edit="a"]')).toBeFocused();
  await page.locator('[data-edit="a"]').click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep this');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pre-write refresh cannot resurrect a locally deleted card', async ({ page }) => {
  const fixture = await backend(page);
  await page.goto('/'); await openCard(page);
  fixture.holdRead = true; await refresh(page);
  await expect.poll(() => Boolean(fixture.pendingRead)).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete ticket', exact: true }).click();
  await expect(page.locator('#card-dialog')).toBeHidden();
  await fixture.pendingRead!();
  await expect(page.locator('[data-ticket-id="a"]')).toHaveCount(0);
});

test('stale ordering is refreshed without replaying the rejected move', async ({ page }) => {
  const fixture = await backend(page);
  await page.goto('/'); await openCard(page);
  fixture.conflictMove = true;
  await page.locator('#editor-column').selectOption('backlog');
  await expect(page.locator('#editor-status')).toContainText('Another save');
  await expect(page.locator('#editor-column')).toHaveValue('review');
  expect(fixture.calls.filter(call => call.path.endsWith('/move'))).toHaveLength(1);
  await page.locator('#editor-column').selectOption('backlog');
  await expect(page.locator('#editor-status')).toHaveText('Ticket moved.');
  expect(fixture.calls.filter(call => call.path.endsWith('/move'))[1].body.expected_order_versions.review).toBe(3);
});

test('forbidden/invalid writes preserve text; failed recovery blocks uncertain retries', async ({ page }) => {
  const fixture = await backend(page);
  await page.goto('/'); await openCard(page);
  await page.getByLabel('Add a comment').fill('Keep my text');
  fixture.failNextComment = 403;
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.locator('#editor-status')).toContainText('Only the comment author');
  await expect(page.getByLabel('Add a comment')).toHaveValue('Keep my text');
  fixture.failNextComment = 422;
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.locator('#editor-status')).toContainText('validation_error');
  fixture.uncertainComment = true; fixture.failReads = true;
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.locator('#editor-status')).toContainText('outcome is uncertain');
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeDisabled();
  fixture.failReads = false;
  await page.getByRole('button', { name: 'Refresh ticket', exact: true }).click();
  await expect(page.locator('#comments')).toContainText('Keep my text');
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeEnabled();
  expect(fixture.calls.filter(call => call.path.endsWith('/comments') && call.method === 'POST')).toHaveLength(3);
});
