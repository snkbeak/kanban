import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardState, contentChanges, contentOf, matches, mergeCard } from '../src/lib/board-state.ts';
import type { Card, OrderVersions } from '../src/lib/api.ts';

export const revisions: OrderVersions = { review: 1, backlog: 0, in_progress: 0, done: 0, blocked: 0 };
export const card: Card = {
  id: 'a', ticket_number: 1, title: 'First', description: 'Details', column: 'review', position: 0,
  tag: 'feature', difficulty: 'medium', health: 'healthy', creator: 'chris', assignees: ['chris'],
  created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z', version: 1, comments_version: 0, comments: [],
};

test('late comment responses preserve newer content; late content responses preserve discussion', () => {
  const content = { ...card, version: 3, title: 'Saved content' };
  const discussion = { ...card, comments_version: 2, comments: [{ id: 'c', text: 'hello', author: 'sean', version: 1, created_at: card.created_at, updated_at: card.updated_at }] };
  const merged = mergeCard(content, discussion);
  assert.equal(merged.title, 'Saved content');
  assert.equal(merged.comments.length, 1);
  assert.deepEqual(mergeCard(merged, content), merged);
});
test('fresh column revisions update neighbor positions without advancing content versions', () => {
  const state = new BoardState();
  state.applySnapshot({ cards: [card], order_versions: revisions });
  state.applySnapshot({ cards: [{ ...card, position: 4 }], order_versions: { ...revisions, review: 2 } });
  state.applyCard(card);
  assert.equal(state.get('a')?.position, 4);
  assert.equal(state.applySnapshot({ cards: [card], order_versions: revisions }), false);
  assert.equal(state.get('a')?.position, 4);
});
test('late snapshots and mutation responses cannot resurrect deleted cards', () => {
  const state = new BoardState();
  state.applySnapshot({ cards: [card], order_versions: revisions });
  state.remove(card.id);
  state.applyCard(card);
  state.applySnapshot({ cards: [card], order_versions: revisions });
  assert.equal(state.cards.length, 0);
});
test('snapshot deletion and its revision prevent stale board resurrection', () => {
  const state = new BoardState();
  state.applySnapshot({ cards: [card], order_versions: revisions });
  state.applySnapshot({ cards: [], order_versions: { ...revisions, review: 2 } });
  assert.equal(state.applySnapshot({ cards: [card], order_versions: revisions }), false);
  assert.equal(state.cards.length, 0);
});
test('content diff contains only edited fields and can clear description/assignments', () => {
  assert.deepEqual(contentChanges(card, contentOf(card)), {});
  assert.deepEqual(contentChanges(card, { ...contentOf(card), description: '', assignees: [] }), { description: '', assignees: [] });
});
test('filters use the full dataset and canonical username/single tag/health values', () => {
  const filters = { query: 'KAN-1', assignee: 'chris', tag: 'feature', health: 'healthy', difficulty: 'medium' };
  assert.equal(matches(card, filters), true);
  assert.equal(matches(card, { ...filters, assignee: '__unassigned' }), false);
  assert.equal(matches({ ...card, assignees: [] }, { ...filters, assignee: '__unassigned' }), true);
  assert.equal(matches(card, { ...filters, query: 'missing' }), false);
});
