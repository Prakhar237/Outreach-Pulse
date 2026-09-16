# Pulse Outreach Dashboard — manual hosting edition

This export runs on standard Next.js 16 / Node.js. It includes the latest business-name Owner column and one-click Linkedin links. It has **no dashboard sign-in or user roles**: everyone with access to the URL can read, edit, import, export, and manage integrations. Search-engine indexing is discouraged, but that is not access control.

## Server configuration

Copy `.env.example` to `.env.local` and fill in your server-only Supabase URL, service-role key, a stable random integration-encryption key of at least 32 characters, and APP_URL. Alternatively, configure these values directly in your hosting provider's environment settings. The private ZIP supplied separately contains the existing database configuration. This GitHub repository intentionally contains no credentials or original lead workbook.

The configured Supabase project already contains the 50 imported leads; no reimport is needed. RLS remains enabled, with database access performed by the server. RLS does not restrict users of this intentionally no-login app.

## Run on a Node.js host

Use Node.js 22.13 or newer (Node.js 24 is suitable).

1. Clone this repository and open the project folder in a terminal.
2. Run `npm ci`.
3. For local development, run `npm run dev` and open http://localhost:3000.
4. For production, set `APP_URL` in `.env.local` to your exact HTTPS origin (no trailing slash).
5. Run `npm run build`, then `npm start` (defaults to port 3000).
6. Keep the Node process running with your host's process manager and place it behind HTTPS.

This is a server app, not a static HTML site. Uploading it to static-only hosting or opening index.html will not run its database/API features.

## Vercel manual deployment

1. Import this repository in Vercel; keep `.env.local` and original lead workbooks out of Git.
2. Import that repository in Vercel. Select Next.js; install command `npm ci`; build command `npm run build`; leave output directory at its default.
3. In Project Settings → Environment Variables, add every value from `.env.local` to the Production environment. Vercel does not automatically receive your ignored local env file.
4. Set `APP_URL` to your actual Vercel origin (for example https://pulseoutreachzdashboard.vercel.app, if available), then deploy. Redeploy after environment changes.
5. Use the resulting Production URL to share with your client. If Vercel Deployment Protection requires sign-in, adjust that project setting according to your intended audience. There is no sign-in inside this app.

Project names and subdomains depend on availability; no Vercel project or domain has been created by this export. Vercel Hobby is restricted to personal/non-commercial use; a client business dashboard needs an appropriate commercial plan: https://vercel.com/docs/plans/hobby . This repository does not purchase a plan or change the existing hosted site.

## Database and integrations

- `db/setup.sql` creates the schema and RLS in a NEW empty Supabase project. Do not run it again on your already-configured database.
- Existing project schema and leads stay in Supabase and are not embedded in the frontend bundle.
- Outlook still requires a Microsoft app registration, client ID, client secret and consent. These are not dashboard sign-in; they authorize mailbox access.
- Microsoft redirect URI: `YOUR_APP_URL/api/oauth/microsoft/callback`. Fill the Microsoft environment values, then connect Outlook in Connections.
- Pipedrive needs the company's existing API token, entered in Connections.
- The exported encryption key is new. Reconnect any provider in this manual deployment rather than reusing previously encrypted credentials from another deployment with a different key.
- The detailed Outlook/Pipedrive instructions are in `public/setup-guide.html`.
- LinkedIn/WhatsApp outreach is logged manually or imported as CSV; this does not automate sending messages.

## Verification

Run `npm test`, `npx tsc --noEmit`, and `npm run build`.
The optional database tests run when PGLITE_MODULE points to a local @electric-sql/pglite installation.

Your original live ChatGPT Sites dashboard was not changed by this export.
