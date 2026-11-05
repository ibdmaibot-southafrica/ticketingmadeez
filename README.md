# TicketingMadeEZ

Internal engineering notes. Hosted on Coolify at `ticketing.nexbdm.co.za`, installed through the HighLevel Marketplace.

## Architecture and access

Next.js, React, TypeScript, PostgreSQL and Tailwind. HighLevel opportunities remain the ticket source. App-owned PostgreSQL tables store notes, private files, activity, measured timestamps, portal access, knowledge articles, projects, tasks and time entries. Every record is scoped to a location. Administrator-only staff rates are frozen into time entries when work is recorded.

Encrypted HighLevel context obtains a short-lived signed staff session. The proxy checks tenant identity and write origins. Routes enforce resource ownership and administrator access. Webhooks require HighLevel's Ed25519 signature, exact app/plan IDs and idempotent receipt processing. Included-service access is independent of Marketplace billing.

## Features

- Ticket board with department, assignment, priority, text and SLA filters.
- Ticket details, internal notes, private attachments, activity, assignment, priority and due dates.
- Response confirmations and resolution measurements recorded in the app. Notes never count as customer responses.
- Single-ticket customer portal conversations and published help articles. One-use invites expire after seven days and can be revoked immediately. Staff notes, attachments, draft articles and financial data stay private.
- Knowledge authoring, draft/publication status and text search.
- Projects with multiple team members, assigned tasks, ticket links, deadlines and statuses.
- Server-timed/manual time entries, one running timer per person, billable work and administrator-only project/staff rates.
- Billing summaries for displayed time entries. No invoice, tax document, payment or subscription is created.
- Optional AI answer drafts using matching published articles from the current location. Review is required; drafts are never sent automatically.
- Responsive customer portal with a web-app manifest. This is mobile web, not a native LeadConnector extension or App Store submission.

## Configuration

Configure `.env.local` from `.env.example`: HighLevel OAuth, `APP_BASE_URL`, PostgreSQL, app shared secret and a random session secret of at least 32 characters. Never commit live secrets.

AI starts off for every account. Administrators connect OpenAI, choose a monthly bracket (USD 10 to 50, 50 to 100, or 100 to 500), and an exact limit within the bracket. Saving the bracket never activates AI or creates a charge. Switching AI off stops new drafts. Existing requests can finish.

Customers connect their own OpenAI API key in Knowledge base. Keys are encrypted with AES-256-GCM and bound to the location and provider. There is no publisher API-key fallback. OpenAI bills the customer directly; neither the app trial nor the subscription includes AI usage or credits. Connection checks model access without paid generation and leaves AI off. GPT-5.4 mini is pinned with verified default rates. See `.env.example` for optional model/rate overrides and the global daily request ceiling. Preserve AI_CREDENTIALS_KEY (or SESSION_SECRET fallback) across deployments; secret rotation requires migration or customer key re-entry. Each request needs consent to the named provider and sends only the question and up to three published article excerpts. OpenAI response storage is disabled. Output is bounded, no tools or paid searches are enabled, and drafts are never sent automatically.

The app atomically reserves a conservative per-request cost against the calendar-month budget in South African time. Measured token usage settles the reservation at configured rates. Unknown/failed requests retain their reservation because the provider may have billed them. A measured cost above the reservation switches AI off. Budget figures exclude taxes, provider pricing changes and usage outside this app; they are not a guarantee about the provider's invoice. Obtain a provider/model/budget decision before activation and reconcile against provider billing.

## Verification

Run `npm run build`, then `npm test`. Tests use synthetic CRM records and a local PGlite PostgreSQL engine. External CRM traffic is blocked. Coverage includes tenant boundaries, files, response measurements, portal privacy/revocation, project/task ownership, timers, rate snapshots and administrator-only financial access. AI generation tests stub the provider and spend no money.

After building, `node tests/fixtures/browser.cjs` exposes `http://localhost:3821`. This local harness authenticates a synthetic account through the normal encrypted-context endpoint and proxies an isolated app on port 3820. It uses no live credentials. The harness and test database are excluded from the runtime container.

## Deployment

Docker builds the app and prunes development dependencies for the runtime image. Coolify deploys the main branch. Database changes are additive and run lazily. Back up PostgreSQL. Private files live in PostgreSQL, limited to 2 MB each and 20 per ticket.

Public webhooks must reach the app without interactive Cloudflare challenges. No real payment is authorised for tests. Operational checks are restricted to NexBDM Front-Desk Showcase. Never use client accounts as fixtures.

## Remaining boundaries

Email intake and acknowledgements still use HighLevel workflows. Voice/video calls, an agency messaging hub, native mobile push, CRM conversation transcript ingestion and accounting-system invoicing remain separate integrations. Do not advertise them as supported. Historical response times and pre-app activity are never inferred from unrelated edit timestamps.
