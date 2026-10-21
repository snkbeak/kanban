import { api, ApiError, columns, type Card, type Column, type Comment, type Content, type User } from '../lib/api';
import { BoardState, contentChanges, contentOf, matches, type Filters } from '../lib/board-state';

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)!;
// All server text is escaped, including attributes. Descriptions/comments remain plain text.
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const healthLabels = { healthy: 'Healthy', at_risk: 'At risk', blocked: 'Blocked' };
const difficultyLabels = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const date = (value: string) => new Date(value).toLocaleString();
const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const avatar = (username: string) => `<span class="avatar" data-person="${escape(username)}" title="${escape(username)}" aria-label="${escape(username)}">${escape(username[0]?.toUpperCase())}</span>`;
const columnOptions = (column: Column) => columns.map(item => `<option value="${item.id}" ${item.id === column ? 'selected disabled' : ''}>${item.title}</option>`).join('');

let state = new BoardState();
let user: User | null = null;
let previousUsername = '';
let users: User[] = [];
let loaded = false;
let busy = false;
let needsRecovery = false;
let uncertainWrite = false;
let refreshController: AbortController | null = null;
let refreshing: Promise<boolean> | null = null;
let epoch = 0;
let dragged: { card: Card; revisions: typeof state.orderVersions } | null = null;
const dialog = $<HTMLDialogElement>('#card-dialog');
const sessionDialog = $<HTMLDialogElement>('#session-dialog');
const form = $<HTMLFormElement>('#card-form');
const commentForm = $<HTMLFormElement>('#comment-form');
type CommentDraft = { base: Comment; text: string };
type Draft = { base?: Card; content: Content; column: Column; comment: string; edits: Map<string, CommentDraft> };
const drafts = new Map<string, Draft>();
let activeId: string | null = null;
let returnFocus: HTMLElement | null = null;
let returnFocusKey: string | undefined;
const activeDraft = () => activeId === null ? undefined : drafts.get(activeId);
const currentCard = () => activeId ? state.get(activeId) : undefined;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function message(text: string, editor = false) { $(editor ? '#editor-status' : '#board-status').textContent = text; }
function describe(error: unknown) {
  if (!(error instanceof ApiError)) return 'Something went wrong. Refresh and try again; your draft is preserved.';
  if (error.status === 403) return 'Only the comment author can change this comment. Your draft is preserved.';
  if (error.status === 404) return 'This ticket or comment was removed. Your draft is preserved.';
  if (error.status === 409) return 'Another save changed this resource. Review the refreshed state before deliberately reapplying your changes.';
  return [error.message, ...error.fields.map(item => `${item.path.filter(part => part !== 'body').join('.')}: ${item.message}`)].join(' ');
}

function filters(): Filters {
  return { query: $<HTMLInputElement>('#ticket-search').value,
    assignee: $<HTMLSelectElement>('#assignee-filter').value, tag: $<HTMLSelectElement>('#tag-filter').value,
    health: $<HTMLSelectElement>('#health-filter').value, difficulty: $<HTMLSelectElement>('#difficulty-filter').value };
}
function hiddenByFilters() { const selected = filters(); return state.cards.some(card => !matches(card, selected)); }
function restoreFocus(root: HTMLElement, render: () => void) {
  const focused = document.activeElement as HTMLInputElement | null;
  const key = focused && root.contains(focused) ? focused.dataset.focus : undefined;
  const selection = focused instanceof HTMLTextAreaElement ? [focused.selectionStart, focused.selectionEnd] : null;
  render();
  if (!key) return;
  const replacement = root.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`);
  replacement?.focus({ preventScroll: true });
  if (selection && replacement instanceof HTMLTextAreaElement) replacement.setSelectionRange(selection[0], selection[1]);
}

function renderBoard() {
  const selected = filters();
  const visible = state.cards.filter(card => matches(card, selected));
  const hidden = visible.length !== state.cards.length;
  $('#ordering-note').hidden = !hidden;
  $('.clear-filters').hidden = !Object.values(selected).some(Boolean);
  $('#board-results').textContent = loaded ? `${visible.length} of ${state.cards.length} tickets across 5 columns` : 'Loading board…';
  const board = $('.kanban-board');
  board.setAttribute('aria-busy', String(!loaded));
  const open = new Set([...board.querySelectorAll<HTMLDetailsElement>('details[open]')].map(item => item.dataset.ticketId));
  restoreFocus(board, () => {
    for (const column of columns) {
      const section = $(`[data-column="${column.id}"]`);
      const cards = visible.filter(card => card.column === column.id);
      const total = state.cards.filter(card => card.column === column.id).length;
      $('.column-count', section).textContent = hidden ? `${cards.length}/${total}` : String(total);
      $('.column-cards', section).innerHTML = cards.map(card => {
        const id = escape(card.id);
        return `<details class="ticket" data-ticket-id="${id}" ${open.has(card.id) ? 'open' : ''}>
          <summary data-focus="summary-${id}" draggable="${!hidden && !busy && !needsRecovery}">
            <span class="ticket-topline"><span class="ticket-id">KAN-${card.ticket_number}</span><span class="health" data-health="${healthLabels[card.health]}"><span aria-hidden="true"></span>${healthLabels[card.health]}</span></span>
            <h3>${escape(card.title)}</h3><span class="ticket-description">${escape(card.description)}</span>
            <span class="ticket-labels"><span class="tag" data-tag="${escape(card.tag)}">${escape(card.tag)}</span><span class="difficulty"><span class="difficulty-bars" data-difficulty="${difficultyLabels[card.difficulty]}" aria-hidden="true"><i></i><i></i><i></i></span>${difficultyLabels[card.difficulty]}</span></span>
            <span class="ticket-footer"><span class="assignees">${card.assignees.length ? card.assignees.map(avatar).join('') : '<span class="unassigned">Unassigned</span>'}</span><span class="ticket-activity"><span class="comment-count">${card.comments.length} comments</span><time datetime="${escape(card.updated_at)}" title="Updated ${escape(date(card.updated_at))}">${escape(shortDate(card.updated_at))}</time></span></span>
          </summary>
          <div class="ticket-details"><p class="plain-text">${escape(card.description)}</p><p class="ticket-credit">Created by ${escape(card.creator)} · ${escape(date(card.created_at))}</p>
            <button data-edit="${id}" data-focus="edit-${id}">Edit / discuss</button>
            <label>Move to <select data-move="${id}" data-focus="move-${id}" aria-label="Move KAN-${card.ticket_number}">${columnOptions(card.column)}</select></label>
          </div></details>`;
      }).join('') || `<p class="column-empty">${!loaded ? 'Loading…' : total ? 'No matching tickets.' : 'No tickets yet.'}</p>`;
    }
  });
  const tagFilter = $<HTMLSelectElement>('#tag-filter');
  const tags = [...new Set([...state.cards.map(card => card.tag), ...(selected.tag ? [selected.tag] : [])])].sort();
  tagFilter.innerHTML = '<option value="">All tags</option>' + tags.map(tag => `<option value="${escape(tag)}">${escape(tag)}</option>`).join('');
  tagFilter.value = selected.tag;
  syncControls();
}

function syncControls() {
  const disabled = busy || needsRecovery || !user || !loaded;
  $<HTMLButtonElement>('#new-card').disabled = disabled;
  $<HTMLButtonElement>('#logout').disabled = busy || !user;
  document.querySelectorAll<HTMLSelectElement>('[data-move]').forEach(select => { select.disabled = disabled; });
  $<HTMLFieldSetElement>('#content-fields').disabled = disabled || (activeId !== 'new' && !currentCard());
  $<HTMLSelectElement>('#editor-column').disabled = disabled || !currentCard();
  $<HTMLButtonElement>('#delete-card').disabled = disabled || !currentCard();
  const draft = activeDraft();
  const stale = draft?.base && currentCard() && draft.base.version !== currentCard()!.version;
  $<HTMLButtonElement>('#save-content').disabled = disabled || Boolean(stale);
  const blocked = draft && (draft.base ? currentCard()?.column === 'blocked' : draft.column === 'blocked');
  field('health').disabled = Boolean(blocked);
  // Keep the original draft value when an external move changes the lock; reapply resolves it.
  if (blocked) field('health').value = 'blocked';
  else if (draft) field('health').value = draft.content.health;
  $<HTMLButtonElement>('#add-comment').disabled = disabled || !currentCard() || currentCard()!.comments.length >= 20;
  $<HTMLTextAreaElement>('textarea', commentForm).disabled = busy || !user || !currentCard();
  $('#comments').querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.disabled = disabled || button.dataset.unavailable === 'true';
  });
  $('#comments').querySelectorAll<HTMLTextAreaElement>('textarea').forEach(input => { input.disabled = busy || !user; });
  for (const id of ['#load-latest', '#reapply-content']) $<HTMLButtonElement>(id).disabled = disabled || !currentCard();
}

function expireSession() {
  if (!previousUsername) { location.replace('/login'); return; }
  user = null;
  refreshController?.abort();
  $('#current-user').textContent = '';
  const username = $<HTMLInputElement>('[name="username"]', sessionDialog);
  username.value = previousUsername;
  if (!sessionDialog.open) sessionDialog.showModal();
  syncControls();
}

async function refresh(): Promise<boolean> {
  if (!user) return false;
  if (refreshing) return refreshing;
  const controller = new AbortController();
  refreshController = controller;
  const startedAt = epoch;
  const work = (async () => {
    try {
      const board = await api.board(controller.signal);
      if (controller.signal.aborted || startedAt !== epoch) return false;
      if (!state.applySnapshot(board)) { message('A newer arrangement is already loaded. Refresh again.'); return false; }
      loaded = true;
      needsRecovery = false;
      message(uncertainWrite ? 'Board refreshed. Check whether your last action succeeded before deliberately retrying.' : 'Up to date.');
      if (!dragged) renderBoard();
      renderEditorUpdates();
      return true;
    } catch (error) {
      if (controller.signal.aborted || startedAt !== epoch) return false;
      if (error instanceof ApiError && error.status === 401) expireSession();
      else message(`${describe(error)} Last successful data is retained. Use Refresh to retry.`);
      return false;
    } finally {
      if (refreshController === controller) { refreshController = null; refreshing = null; }
    }
  })();
  refreshing = work;
  return work;
}

// Serialize local writes and invalidate any pre-write board snapshot. No mutation is replayed.
async function mutate(action: () => Promise<void>, success: string) {
  if (busy || !user || needsRecovery) return;
  if (uncertainWrite && !window.confirm('The previous request may already have succeeded. You have refreshed the board. Have you checked the result and want to perform this action?')) return;
  uncertainWrite = false;
  busy = true;
  epoch++;
  refreshController?.abort(); refreshController = null; refreshing = null;
  syncControls();
  let failure = '';
  try {
    await action();
    needsRecovery = true;
    message(success, dialog.open);
  } catch (error) {
    failure = describe(error);
    if (error instanceof ApiError && error.status === 401) expireSession();
    else if (error instanceof ApiError && (error.uncertain || error.status === 409 || error.status === 404)) {
      needsRecovery = true;
      uncertainWrite = error.uncertain;
      if (uncertainWrite) failure += ' The outcome is uncertain; check the refreshed board before retrying. Nothing is automatically replayed.';
    }
  }
  // Fetch after all writes, including discussion, without replacing draft preconditions.
  const refreshed = user ? await refresh() : false;
  busy = false;
  if (failure) message(failure, dialog.open);
  else if (!refreshed && user) message(`${success} Refresh is required before another change.`, dialog.open);
  renderBoard(); renderEditorUpdates(); syncControls();
}

function fillForm(draft: Draft) {
  for (const [key, value] of Object.entries(draft.content)) if (key !== 'assignees') field(key).value = String(value);
  field('column').value = draft.column;
  $('#editor-assignees').innerHTML = users.map(person => `<label><input type="checkbox" name="assignees" value="${escape(person.username)}" ${draft.content.assignees.includes(person.username) ? 'checked' : ''} />${escape(person.username)}</label>`).join('');
  $<HTMLTextAreaElement>('textarea', commentForm).value = draft.comment;
  $('#comment-length').textContent = `${draft.comment.length} / 4000`;
}

function openEditor(id: string) {
  if (busy) return;
  const card = state.get(id);
  if (!card && id !== 'new') return;
  activeId = id;
  if (!drafts.has(id)) drafts.set(id, {
    base: card, content: card ? contentOf(card) : { title: '', description: '', tag: '', difficulty: 'medium', health: 'healthy', assignees: [] },
    column: card?.column ?? 'review', comment: '', edits: new Map(),
  });
  returnFocus = document.activeElement as HTMLElement;
  returnFocusKey = returnFocus?.dataset.focus;
  fillForm(activeDraft()!);
  $('#editor-heading').textContent = card ? `KAN-${card.ticket_number}` : 'New ticket';
  $('#create-column-label').hidden = Boolean(card);
  $('#existing-card-actions').hidden = !card;
  $('#discussion').hidden = !card;
  message('', true);
  renderEditorUpdates();
  if (!dialog.open) dialog.showModal();
}

function renderEditorUpdates() {
  const draft = activeDraft();
  if (!draft) return;
  const card = currentCard();
  $('#content-conflict').hidden = !card || !draft.base || card.version === draft.base.version;
  if (card) {
    $('#editor-credit').textContent = `Created by ${card.creator} · ${date(card.created_at)} · Updated ${date(card.updated_at)}`;
    $('#latest-content').textContent = `Title: ${card.title}\nDescription: ${card.description}\nTag: ${card.tag}\nDifficulty: ${difficultyLabels[card.difficulty]}\nHealth: ${healthLabels[card.health]}\nAssignees: ${card.assignees.join(', ') || 'Unassigned'}\nColumn: ${columns.find(item => item.id === card.column)!.title}`;
    $<HTMLSelectElement>('#editor-column').innerHTML = columnOptions(card.column);
    renderComments(card, draft);
  } else if (draft.base) {
    message('This ticket was deleted. Your draft remains here so you can copy it.', true);
    renderComments(undefined, draft);
  } else $('#editor-credit').textContent = '';
  syncControls();
}

function renderComments(card: Card | undefined, draft: Draft) {
  const comments = card?.comments ?? [];
  $('#discussion-heading').textContent = `Comments (${comments.length}/20)`;
  $('#comment-cap').hidden = comments.length < 20;
  const ids = [...new Set([...comments.map(comment => comment.id), ...draft.edits.keys()])];
  const root = $('#comments');
  const markup = ids.map(id => {
    const comment = comments.find(item => item.id === id);
    const edit = draft.edits.get(id);
    const item = comment ?? edit!.base;
    const stale = edit && comment && edit.base.version !== comment.version;
    const owned = item.author === user?.username;
    return `<article class="ticket-comment" data-comment="${escape(id)}">
      <p><strong>${escape(item.author)}</strong> <time datetime="${escape(item.created_at)}">${escape(date(item.created_at))}</time>${item.version > 1 ? ' · edited' : ''}</p>
      <p class="plain-text">${comment ? escape(comment.text) : 'This comment was removed. Copy your draft before cancelling.'}</p>
      ${edit ? `<form data-comment-form="${escape(id)}"><label for="comment-editor-${escape(id)}">Edit comment</label><textarea id="comment-editor-${escape(id)}" data-focus="comment-${escape(id)}" name="text" maxlength="4000" required rows="3">${escape(edit.text)}</textarea><p class="ticket-credit" data-length>${edit.text.length} / 4000</p>
        ${stale ? '<p>This comment changed. The latest text is shown above; your draft is below.</p><button type="button" data-comment-action="reapply">Keep my text against latest</button><button type="button" data-comment-action="reload">Load latest text</button>' : ''}
        <button type="submit" data-unavailable="${!comment || Boolean(stale) || !owned}">Save comment</button><button type="button" data-comment-action="cancel">Cancel</button></form>`
        : owned ? '<button type="button" data-comment-action="edit">Edit comment</button><button type="button" class="danger" data-comment-action="delete">Delete comment</button>' : ''}
    </article>`;
  }).join('') || '<p class="ticket-credit">No comments yet.</p>';
  // Avoid replacing focused inputs on ordinary polls; preserve selection when discussion changes.
  if (root.dataset.markup !== markup) {
    restoreFocus(root, () => { root.innerHTML = markup; });
    root.dataset.markup = markup;
  }
}

form.addEventListener('input', () => {
  const draft = activeDraft(); if (!draft) return;
  const data = new FormData(form);
  draft.content = {
    title: field('title').value, description: field('description').value, tag: field('tag').value,
    difficulty: field('difficulty').value as Content['difficulty'],
    // Locked health can display a new server value; don't overwrite a stale content draft.
    health: field('health').disabled ? draft.content.health : field('health').value as Content['health'],
    assignees: data.getAll('assignees').map(String),
  };
  draft.column = field('column').value as Column;
  if (!draft.base && draft.column === 'blocked') draft.content.health = 'blocked';
  syncControls();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const draft = activeDraft(); if (!draft || !activeId) return;
  const content = { ...draft.content, title: draft.content.title.trim(), tag: draft.content.tag.trim().toLowerCase() };
  if (!content.title || !content.tag) { message('Title and one tag are required; spaces alone are not valid.', true); return; }
  if (content.assignees.length > 3) { message('Choose at most three assignees.', true); return; }
  const id = activeId;
  if (draft.base && draft.base.version !== currentCard()?.version) { renderEditorUpdates(); return; }
  const changes = draft.base ? contentChanges(draft.base, content) : content;
  if (!Object.keys(changes).length) { message('No content changes to save.', true); return; }
  void mutate(async () => {
    const card = draft.base ? await api.patch(id, changes, draft.base.version) : await api.create({ ...content, column: draft.column });
    state.applyCard(card);
    drafts.delete(id);
    draft.base = card; draft.content = contentOf(card); draft.column = card.column;
    drafts.set(card.id, draft); activeId = card.id;
    fillForm(draft);
    $('#editor-heading').textContent = `KAN-${card.ticket_number}`;
    $('#create-column-label').hidden = true; $('#existing-card-actions').hidden = false; $('#discussion').hidden = false;
  }, 'Ticket saved.');
});
$('#load-latest').addEventListener('click', () => {
  const draft = activeDraft(), card = currentCard(); if (!draft || !card) return;
  draft.base = card; draft.content = contentOf(card); draft.column = card.column;
  fillForm(draft); renderEditorUpdates(); message('Latest content loaded.', true);
});
$('#reapply-content').addEventListener('click', () => {
  const draft = activeDraft(), card = currentCard(); if (!draft?.base || !card) return;
  const changes = contentChanges(draft.base, draft.content);
  draft.content = { ...contentOf(card), ...changes };
  if (card.column === 'blocked') draft.content.health = 'blocked';
  draft.base = card; draft.column = card.column;
  fillForm(draft); renderEditorUpdates(); message('Draft reapplied to the latest content. Review it, then Save ticket.', true);
});

async function move(card: Card, column: Column, before: string | null, revisions = { ...state.orderVersions }) {
  await mutate(async () => {
    const result = await api.move(card, column, before, revisions);
    state.applyCard(result.card); state.orderVersions = result.order_versions;
  }, 'Ticket moved.');
}
$('#editor-column').addEventListener('change', event => {
  const card = currentCard(); const select = event.target as HTMLSelectElement;
  if (card && select.value !== card.column) void move(card, select.value as Column, null);
});
$('#delete-card').addEventListener('click', () => {
  const card = currentCard(); if (!card) return;
  if (!window.confirm(`Delete KAN-${card.ticket_number} “${card.title}”? This removes the ticket and everyone's ${card.comments.length} comments permanently.`)) return;
  void mutate(async () => {
    await api.delete(card); state.remove(card.id); drafts.delete(card.id);
    dialog.close(); activeId = null; $('#new-card').focus();
  }, 'Ticket deleted.');
});

commentForm.addEventListener('input', () => {
  const draft = activeDraft(); if (!draft) return;
  draft.comment = $<HTMLTextAreaElement>('textarea', commentForm).value;
  $('#comment-length').textContent = `${draft.comment.length} / 4000`;
});
commentForm.addEventListener('submit', event => {
  event.preventDefault();
  const draft = activeDraft(), card = currentCard(); if (!draft || !card) return;
  const text = draft.comment.trim(); if (!text) { message('Comment text cannot be blank.', true); return; }
  void mutate(async () => {
    state.applyCard(await api.comment(card.id, text));
    draft.comment = ''; $<HTMLTextAreaElement>('textarea', commentForm).value = ''; $('#comment-length').textContent = '0 / 4000';
  }, 'Comment added.');
});
$('#comments').addEventListener('input', event => {
  const input = event.target as HTMLTextAreaElement;
  const article = input.closest<HTMLElement>('[data-comment]');
  const edit = activeDraft()?.edits.get(article?.dataset.comment ?? '');
  if (edit) { edit.text = input.value; $('[data-length]', article!).textContent = `${edit.text.length} / 4000`; }
});
$('#comments').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-comment-action]');
  if (!button || busy || needsRecovery) return;
  const id = button.closest<HTMLElement>('[data-comment]')!.dataset.comment!;
  const draft = activeDraft(), card = currentCard(); if (!draft) return;
  const comment = card?.comments.find(item => item.id === id);
  const action = button.dataset.commentAction;
  if (action === 'cancel') draft.edits.delete(id);
  else if (comment && comment.author === user?.username) {
    if (action === 'edit' || action === 'reload') draft.edits.set(id, { base: comment, text: comment.text });
    if (action === 'reapply') draft.edits.get(id)!.base = comment;
    if (action === 'delete' && window.confirm('Delete your comment?')) {
      void mutate(async () => { state.applyCard(await api.deleteComment(card!.id, comment)); }, 'Comment deleted.');
    }
  }
  renderEditorUpdates();
});
$('#comments').addEventListener('submit', event => {
  event.preventDefault();
  const target = event.target as HTMLFormElement;
  const id = target.dataset.commentForm!;
  const draft = activeDraft(), card = currentCard(); const edit = draft?.edits.get(id);
  if (!draft || !card || !edit) return;
  const latest = card.comments.find(item => item.id === id);
  if (!latest || latest.version !== edit.base.version) { renderEditorUpdates(); return; }
  const text = edit.text.trim();
  if (!text) { message('Comment text cannot be blank.', true); return; }
  if (text === edit.base.text) { draft.edits.delete(id); renderEditorUpdates(); return; }
  void mutate(async () => {
    state.applyCard(await api.editComment(card.id, edit.base, text)); draft.edits.delete(id);
  }, 'Comment saved.');
});

function closeEditor() {
  if (busy) return;
  dialog.close(); activeId = null;
  const opener = returnFocusKey ? document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(returnFocusKey)}"]`) : returnFocus;
  if (opener?.isConnected) opener.focus(); else $('#new-card').focus();
}
$('#close-editor').addEventListener('click', closeEditor);
dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('#new-card').addEventListener('click', () => openEditor('new'));
$('.kanban-board').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-edit]');
  if (button) openEditor(button.dataset.edit!);
});
$('.kanban-board').addEventListener('change', event => {
  const select = event.target as HTMLSelectElement;
  const card = state.get(select.dataset.move ?? '');
  if (card && select.value !== card.column) void move(card, select.value as Column, null);
});
const toolbar = $<HTMLFormElement>('.board-toolbar');
toolbar.addEventListener('submit', event => event.preventDefault());
toolbar.addEventListener('input', renderBoard);
toolbar.addEventListener('reset', () => { queueMicrotask(renderBoard); });

function endDrag() {
  dragged = null;
  document.querySelectorAll('.is-dragging, .is-drop-target, .drop-before').forEach(item => item.classList.remove('is-dragging', 'is-drop-target', 'drop-before'));
}
$('.kanban-board').addEventListener('dragstart', event => {
  const dragEvent = event as DragEvent;
  const ticket = (event.target as HTMLElement).closest<HTMLElement>('[data-ticket-id]');
  const card = state.get(ticket?.dataset.ticketId ?? '');
  if (!card || !dragEvent.dataTransfer || busy || needsRecovery || hiddenByFilters()) { event.preventDefault(); return; }
  dragged = { card, revisions: { ...state.orderVersions } };
  dragEvent.dataTransfer.effectAllowed = 'move'; dragEvent.dataTransfer.setData('text/plain', card.id);
  ticket!.classList.add('is-dragging');
});
function dropAnchor(column: HTMLElement, y: number): string | null {
  const cards = [...column.querySelectorAll<HTMLElement>('.ticket')].filter(item => item.dataset.ticketId !== dragged?.card.id);
  return cards.find(item => { const rect = item.getBoundingClientRect(); return y < rect.top + rect.height / 2; })?.dataset.ticketId ?? null;
}
$('.kanban-board').addEventListener('dragover', event => {
  const dragEvent = event as DragEvent;
  const column = (event.target as HTMLElement).closest<HTMLElement>('[data-column]');
  if (!dragged || !column || hiddenByFilters() || busy) return;
  event.preventDefault();
  document.querySelectorAll('.is-drop-target, .drop-before').forEach(item => item.classList.remove('is-drop-target', 'drop-before'));
  column.classList.add('is-drop-target');
  const before = dropAnchor(column, dragEvent.clientY);
  if (before) column.querySelector(`[data-ticket-id="${CSS.escape(before)}"]`)?.classList.add('drop-before');
});
$('.kanban-board').addEventListener('drop', event => {
  const dragEvent = event as DragEvent;
  const column = (event.target as HTMLElement).closest<HTMLElement>('[data-column]');
  if (!dragged || !column || hiddenByFilters() || busy) { endDrag(); return; }
  event.preventDefault();
  const { card, revisions } = dragged;
  const before = dropAnchor(column, dragEvent.clientY);
  const destination = column.dataset.column as Column;
  const inColumn = state.cards.filter(item => item.column === card.column);
  const next = inColumn[inColumn.findIndex(item => item.id === card.id) + 1]?.id ?? null;
  endDrag();
  if (destination === card.column && before === next) { renderBoard(); return; }
  void move(card, destination, before, revisions);
});
document.addEventListener('dragend', () => { endDrag(); renderBoard(); });

async function initialize() {
  try {
    user = await api.me(); previousUsername = user.username;
    users = await api.users();
    $('#current-user').textContent = user.username;
    $('.team').innerHTML = users.map(person => avatar(person.username)).join('');
    const select = $<HTMLSelectElement>('#assignee-filter');
    select.innerHTML = '<option value="">All assignees</option><option value="__unassigned">Unassigned</option>' + users.map(person => `<option value="${escape(person.username)}">${escape(person.username)}</option>`).join('');
    await refresh(); syncControls();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) expireSession();
    else message(`${describe(error)} Use Refresh to reconnect.`);
  }
}
$('#refresh-board').addEventListener('click', () => { if (!busy) void (users.length && user ? refresh() : initialize()); });
$('#refresh-editor').addEventListener('click', () => { if (!busy) void refresh(); });
$('#logout').addEventListener('click', () => {
  if ([...drafts.values()].some(draft => draft.comment || draft.edits.size || Object.keys(contentChanges(draft.base ?? { title: '', description: '', tag: '', difficulty: 'medium', health: 'healthy', assignees: [] }, draft.content)).length)
    && !window.confirm('Log out and discard unsaved drafts in this tab?')) return;
  void mutate(async () => {
    await api.logout(); drafts.clear(); user = null; location.replace('/login');
  }, 'Logged out.');
});
sessionDialog.addEventListener('cancel', event => event.preventDefault());
$<HTMLFormElement>('#session-form').addEventListener('submit', async event => {
  event.preventDefault();
  const loginForm = event.target as HTMLFormElement;
  const button = $<HTMLButtonElement>('button', loginForm);
  if (button.disabled) return;
  button.disabled = true;
  try {
    const data = new FormData(loginForm);
    const restored = await api.login(String(data.get('username')), String(data.get('password')));
    if (restored.username !== previousUsername) {
      drafts.clear(); dialog.close(); activeId = null; state = new BoardState(); loaded = false;
    }
    user = restored; previousUsername = restored.username;
    $<HTMLInputElement>('[name="password"]', loginForm).value = '';
    $('#session-status').textContent = ''; sessionDialog.close();
    await initialize();
  } catch (error) {
    $('#session-status').textContent = error instanceof ApiError && error.status === 401 ? 'Unable to log in. Check your username and password.' : 'Unable to log in. Check your connection and try again.';
  } finally { button.disabled = false; }
});
setInterval(() => { if (user && !document.hidden && !busy && !dragged) void refresh(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy && !dragged) void refresh(); });
window.addEventListener('focus', () => { if (!document.hidden && !busy && !dragged) void refresh(); });
void initialize();
