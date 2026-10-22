// Mirrors backend/app/schemas/{cards,comments,users}.py; wire values stay canonical.
export const columns = [
  { id: 'review', title: 'Review / brainstorm' },
  { id: 'backlog', title: 'Backlog' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'done', title: 'Done' },
  { id: 'blocked', title: 'Blocked' },
] as const;
export type Column = typeof columns[number]['id'];
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Health = 'healthy' | 'at_risk' | 'blocked';
export interface User { username: string }
export interface Comment {
  id: string; text: string; author: string; created_at: string; updated_at: string; version: number;
}
export interface Content {
  title: string; description: string; tag: string; difficulty: Difficulty; health: Health; assignees: string[];
}
export interface Card extends Content {
  id: string; ticket_number: number; column: Column; position: number; creator: string;
  created_at: string; updated_at: string; version: number; comments_version: number; comments: Comment[];
}
export type OrderVersions = Record<Column, number>;
export interface Board { cards: Card[]; order_versions: OrderVersions }
export interface MoveResult { card: Card; order_versions: OrderVersions }
export interface FieldError { path: (string | number)[]; message: string; type?: string }
export class ApiError extends Error {
  status: number;
  code: string;
  fields: FieldError[];
  retryAfterSeconds: number | null;
  constructor(status: number, code: string, message: string, fields: FieldError[] = [], retryAfterSeconds: number | null = null) {
    super(message);
    this.status = status; this.code = code; this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
  get uncertain() { return this.status === 0 || this.status >= 500; }
}

function retryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1, Math.ceil(seconds)) : null;
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const seconds = error.retryAfterSeconds;
      return seconds === null
        ? 'Too many login attempts. Please wait a few minutes before trying again.'
        : `Too many login attempts. Try again after ${new Date(Date.now() + seconds * 1000).toLocaleTimeString()} (in ${seconds} seconds).`;
    }
    if (error.status === 401) return 'Unable to log in. Check your username and password.';
    if (error.status === 503) return 'Login is temporarily unavailable. Please try again later.';
  }
  return 'Unable to log in. Check your connection and try again.';
}

export async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(25000);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and refresh.');
  }
  if (response.status === 204 && response.ok) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error?.code ?? 'gateway_error',
      payload?.error?.message ?? `Server request failed (${response.status}).`, payload?.error?.fields ?? [],
      retryAfter(response.headers.get('Retry-After')));
  }
  if (payload === null) throw new ApiError(502, 'invalid_response', 'The server returned an unexpected response. Refresh to check the result.');
  return payload as T;
}
const idPath = (id: string) => `/cards/${encodeURIComponent(id)}`;
export const api = {
  me: () => request<User>('/auth/me'),
  login: (username: string, password: string) => request<User>('/auth/login', 'POST', { username, password }),
  logout: () => request<void>('/auth/logout', 'POST'),
  users: () => request<User[]>('/users'),
  board: (signal?: AbortSignal) => request<Board>('/cards', 'GET', undefined, signal),
  create: (content: Content & { column: Column }) => request<Card>('/cards', 'POST', content),
  patch: (id: string, changes: Partial<Content>, version: number) => request<Card>(idPath(id), 'PATCH', { ...changes, expected_version: version }),
  move: (card: Card, column: Column, before: string | null, revisions: OrderVersions) => request<MoveResult>(`${idPath(card.id)}/move`, 'POST', {
    column, before_card_id: before, expected_version: card.version, expected_order_versions: revisions,
  }),
  delete: (card: Card) => request<void>(`${idPath(card.id)}?expected_version=${card.version}&expected_comments_version=${card.comments_version}`, 'DELETE'),
  comment: (id: string, text: string) => request<Card>(`${idPath(id)}/comments`, 'POST', { text }),
  editComment: (id: string, comment: Comment, text: string) => request<Card>(`${idPath(id)}/comments/${encodeURIComponent(comment.id)}`, 'PATCH', { text, expected_comment_version: comment.version }),
  deleteComment: (id: string, comment: Comment) => request<Card>(`${idPath(id)}/comments/${encodeURIComponent(comment.id)}?expected_comment_version=${comment.version}`, 'DELETE'),
};
