import { columns, type Board, type Card, type Content, type OrderVersions } from './api.ts';

// Full-card responses may contain newer content and older discussion, or vice versa.
export function mergeCard(current: Card | undefined, incoming: Card): Card {
  if (!current) return incoming;
  const content = incoming.version >= current.version ? incoming : current;
  const discussion = incoming.comments_version >= current.comments_version ? incoming : current;
  return { ...content, comments: discussion.comments, comments_version: discussion.comments_version };
}

export class BoardState {
  cards: Card[] = [];
  orderVersions: OrderVersions = { review: 0, backlog: 0, in_progress: 0, done: 0, blocked: 0 };
  private deleted = new Set<string>();
  applySnapshot(board: Board): boolean {
    // Neighbor positions have no content-version increment. Reject stale arrangements.
    if (columns.some(({ id }) => board.order_versions[id] < this.orderVersions[id])) return false;
    const current = new Map(this.cards.map(card => [card.id, card]));
    this.cards = board.cards.filter(card => !this.deleted.has(card.id)).map(card => ({
      ...mergeCard(current.get(card.id), card), column: card.column, position: card.position,
    }));
    this.orderVersions = { ...board.order_versions };
    return true;
  }
  applyCard(card: Card) {
    if (this.deleted.has(card.id)) return;
    const index = this.cards.findIndex(item => item.id === card.id);
    if (index < 0) this.cards.push(card);
    else {
      const current = this.cards[index];
      const merged = mergeCard(current, card);
      this.cards[index] = card.version > current.version ? merged : { ...merged, column: current.column, position: current.position };
    }
  }
  remove(id: string) { this.deleted.add(id); this.cards = this.cards.filter(card => card.id !== id); }
  get(id: string) { return this.cards.find(card => card.id === id); }
}
export const contentOf = (card: Content): Content => ({
  title: card.title, description: card.description, tag: card.tag,
  difficulty: card.difficulty, health: card.health, assignees: [...card.assignees],
});
export function contentChanges(base: Content, draft: Content): Partial<Content> {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(base[key as keyof Content])));
}
export interface Filters { query: string; assignee: string; tag: string; health: string; difficulty: string }
export function matches(card: Card, filters: Filters) {
  return `KAN-${card.ticket_number} ${card.title}`.toLowerCase().includes(filters.query.trim().toLowerCase())
    && (!filters.assignee || (filters.assignee === '__unassigned' ? !card.assignees.length : card.assignees.includes(filters.assignee)))
    && (!filters.tag || card.tag === filters.tag)
    && (!filters.health || card.health === filters.health)
    && (!filters.difficulty || card.difficulty === filters.difficulty);
}
