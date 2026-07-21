# TicketingMadeEZ

Support ticketing / helpdesk for GoHighLevel sub-accounts. Native pipelines, custom fields, workflows, email-to-ticket, SLA tracking.

Internal build for NexBDM. Delivered as a GHL Marketplace App.

## Stack

- Next.js 15 App Router, TypeScript, Tailwind
- Upstash Redis for token + per-location state
- Deploys to Vercel (subdomain `ticketing.nexbdm.co.za`)
- No custom database, no admin dashboard hosted separately from the settings iframe

## Repo layout

```
01_App/            Next.js app (this dir)
02_Snapshot/       GHL snapshot JSON exports (workflow templates)
03_Marketplace/    Marketplace listing assets (screenshots, copy, logo)
04_Docs/           App creation log, working notes, submission checklists
```

## Endpoints

| Route | Purpose |
|-------|---------|
| `/` | Public landing page |
| `/install/success` | Post-install landing |
| `/install/partial` | Install completed but provisioning failed, needs retry |
| `/install/error` | Install failed |
| `/settings?locationId=...` | Admin UI, iframed inside GHL as a Custom Menu |
| `/api/oauth/callback` | GHL OAuth redirect target: exchanges code for tokens, provisions pipeline + custom fields |
| `/api/webhooks/ghl` | Unified webhook: INSTALL, UNINSTALL, PLAN_UPDATED |

## Env vars

Copy `.env.example` to `.env.local` and populate:

- `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`: from the marketplace app slot at `marketplace.gohighlevel.com/apps` → app → Advanced Settings → Auth (or Install link)
- `GHL_APP_ID`: the app id (already set to `6a5e75aeb65bde58d9968235`)
- `APP_BASE_URL`: public URL, e.g. `https://ticketing.nexbdm.co.za`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: from Upstash console

## Local dev

```
npm install
cp .env.example .env.local
# fill in secrets
npm run dev
```

Runs on port 3810.

## Deploy

```
vercel --prod
```

Then in the Vercel project settings, add the env vars from `.env.example`.

DNS: CNAME `ticketing.nexbdm.co.za` → `cname.vercel-dns.com` via Cloudflare.

After deploy, update the marketplace app slot with:
- Redirect URL: `https://ticketing.nexbdm.co.za/api/oauth/callback`
- Webhook URL: `https://ticketing.nexbdm.co.za/api/webhooks/ghl`

## Free tier vs paid tier

Free (native GHL primitives, no monetization):
- Single Support Tickets pipeline (New / In Progress / Resolved / Closed)
- Custom fields on opportunity: Ticket Priority, Ticket Source, Ticket Description
- Email-to-ticket via GHL Conversations + Workflow (setup in Getting Started guide)
- Auto-acknowledge workflow (setup in Getting Started guide)
- Manual or GHL-native round-robin assignment

Paid ($15/mo, gated via GHL Marketplace billing):
- Multi-department (multiple pipelines)
- SLA policies per department + breach notifications
- Reporting: response time, resolution rate, SLA compliance

Feature gating is driven by the `plan` field on the per-location install record in KV, which is set on install (defaults to `free`) and updated by the `PLAN_UPDATED` webhook.
