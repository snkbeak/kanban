import { request } from '@playwright/test';

export default async function setup() {
  if (process.env.KANBAN_LIVE !== '1') {
    throw new Error('Live acceptance is disabled. Configure the selected application database and existing accounts, then set KANBAN_LIVE=1. No accounts are seeded.');
  }
  const required = ['KANBAN_LIVE_USER_A', 'KANBAN_LIVE_PASSWORD_A', 'KANBAN_LIVE_USER_B', 'KANBAN_LIVE_PASSWORD_B'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing local credentials: ${missing.join(', ')}. Do not put passwords in source control.`);
  if (process.env.KANBAN_LIVE_USER_A!.trim().toLowerCase() === process.env.KANBAN_LIVE_USER_B!.trim().toLowerCase()) {
    throw new Error('Two different existing accounts are required for live collaboration acceptance.');
  }
  const client = await request.newContext();
  try {
    const response = await client.get('http://127.0.0.1:4321/api/health/ready', { timeout: 10_000 });
    if (response.status() !== 200 || (await response.json()).status !== 'ok') throw new Error('Not ready');
  } catch {
    throw new Error('Live readiness failed through http://127.0.0.1:4321/api. Start configured FastAPI and the Astro development proxy before this check.');
  } finally {
    await client.dispose();
  }
}
