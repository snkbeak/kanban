# Kanban frontend

Astro frontend configured for Cloudflare Workers Static Assets at
`https://kanban.sneakybeak.net`, deployed with Wrangler. The Worker name is
`kanban-sneakybeak-net`. Only the subdomain is configured; the root domain's
existing site is separate.

This configuration currently serves the static frontend scaffold. The FastAPI
backend and `/api` proxy described in [the implementation plan](../.agent/05-cloudflare-deployment.md)
will be added separately.

## Local development

Use Node.js 22.22.0 or newer. From the repository root:

```powershell
cd frontend
npm ci
npm run dev -- --background
```

Manage the Astro background server with `npm run astro -- dev status`,
`npm run astro -- dev logs`, and `npm run astro -- dev stop`.

## Cloudflare login

Run these commands inside `frontend/`. First check your existing authentication:

```powershell
npx wrangler whoami
```

Wrangler normally stores OAuth credentials in its global user configuration, so
a login from another repository under the same Windows user can already work
here. If `whoami` shows the correct account, skip login. If it says you are not
authenticated, open the browser login flow with:

```powershell
npx wrangler login
npx wrangler whoami
```

Choose the Cloudflare account that owns the active `sneakybeak.net` zone. If you
have multiple accounts, set the intended `account_id` in `wrangler.jsonc` before
deployment. An explicitly configured API token or authentication profile may
override the default browser login. See [Wrangler authentication commands](https://developers.cloudflare.com/workers/wrangler/commands/general/).

## Build and preview without publishing

```powershell
npm run build
npm run preview
```

To build and preview using Cloudflare's local runtime instead of Astro's preview
server:

```powershell
npm run preview:cloudflare
```

Stop either foreground preview with Ctrl+C. Neither preview publishes the site.

## Deploy when ready

The following command builds Astro and then publishes to Cloudflare. Run it only
when you intend to deploy:

```powershell
npm run deploy
```

Wrangler uses `wrangler.jsonc` to upload `dist/` and attach the custom domain
`kanban.sneakybeak.net`. Cloudflare provisions the custom-domain DNS record and
certificate during setup. The domain must belong to an active zone in the same
account; resolve a conflicting record for that exact subdomain if Cloudflare
reports one. See [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

The configuration disables `workers.dev` and preview URLs, and matches your
other project's trailing-slash and 404 handling. Static output does not require
an Astro Cloudflare SSR adapter. See [Cloudflare's Astro guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/).

No deployment or DNS changes are performed by installing dependencies or editing
these files. Keep local secrets in ignored `.dev.vars` files; never put them in
`wrangler.jsonc` or browser-visible assets.
