# TACTIOPBOT setup, shared database, and website

The Discord bot and same-origin website share the `TACTIOPBOT` MongoDB database through one MongoDB client in `db.js`. The static dashboard is served from `public/`; its browser code talks only to the Express API. MongoDB credentials and Discord OAuth tokens remain server-side.

## Local setup

1. Install Node.js 20.8 or newer and run `npm ci`.
2. Copy `.env.example` to `.env` and fill in local values. Never commit `.env`.
3. Add the local OAuth callback to the Discord Developer Portal and configure the website variables below.
4. Run `npm start`. The bot and website run in the same process on `PORT` (default `3000`).
5. Run `npm run test` for the offline test suite and `npm run test:db` to ping Atlas and verify migration.

## Website-only local OAuth testing

Use `npm run dev:web` to serve the existing website and authentication routes on `127.0.0.1` without starting the Discord client or notification scheduler. Open it as `http://localhost:3000/`, not `http://127.0.0.1:3000/`: OAuth callbacks use `localhost`, and the session cookie is host-specific. The launcher uses `MONGODB_URI` and the `TACTIOPBOT` database, matching the Discord bot. `TACTIOPBOT_WEB_MONGODB_URI` is used only when `MONGODB_URI` is absent; the optional database-name override must remain `TACTIOPBOT`. Website authentication data is isolated in the `web_accounts` and `web_sessions` collections and does not modify the bot's collections. Local account and session writes therefore persist in the existing database; use unique test accounts and do not treat this mode as an isolated test database. Discord sign-in is available when the shared Discord OAuth variables are configured; dashboard guild APIs remain disabled without the bot client. If MongoDB is unreachable, the launcher still serves public pages but returns `503` for authentication, profile, and dashboard routes. It checks connection health every 15 seconds and retries 15 seconds after each failed check or connection attempt, including after an established connection drops. Verify Atlas Network Access includes the machine's current outbound IP and that the database user has the required permissions.

## Website clan chat

Sign in to the website and open the Clan Chat dashboard. Use **Commands** to choose a bot command; `/clanmission` and `/missions` open eight mission selectors, with unused slots left on **Skip**. Press **Done** to post the command, its text result, and generated operator-placement image in the chat. Chat messages show the account's web display name without adding the clan tag to the name; the clan remains the room and message-visibility boundary.

For Google testing, set `TACTIOBOT_DEV_GOOGLE_OAUTH_ENABLED=true` and register `http://localhost:3000/auth/google/callback` as an authorized redirect URI in Google Cloud Console. Set `TACTIOBOT_DEV_GOOGLE_OAUTH_REDIRECT_URI` to that exact URI. If using another `TACTIOBOT_DEV_PORT`, update both the callback URI and Google Cloud registration to that port. Optional `TACTIOBOT_DEV_GOOGLE_CLIENT_ID` and `TACTIOBOT_DEV_GOOGLE_CLIENT_SECRET` override the shared `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; the shared credentials are used when development overrides are empty. Without the explicit development enable flag and a valid callback, Google sign-in remains disabled. Start only after reviewing these development settings, then open `http://localhost:3000/`; stop with Ctrl+C. The launcher never prints connection URIs or credentials.

Email verification uses Gmail SMTP over required STARTTLS. The repository example and local setup use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=tactiopbot@gmail.com`, and `EMAIL_FROM=TACTIOPBOT <tactiopbot@gmail.com>`. Leave `SMTP_PASS` empty until a Google App Password is ready, then set it only in the private `.env` or deployment environment. Email delivery remains disabled until that password is present. `EMAIL_TEST_ADMIN_EMAILS` is a comma-separated allowlist of verified website account addresses; it defaults to `tactiopbot@gmail.com` in the example configuration. An authorized administrator can use the dashboard's Administrator email test button to send a branded test to their own verified account address. The endpoint is same-origin protected and limited to three sends per hour. Tests use an injected mail transport and never contact Gmail.

## Environment variables

Configure variables in the environment of each running service; a local `.env` file is not automatically uploaded to Deploy Hatch.

- `TOKEN` or `DISCORD_TOKEN`: Discord bot token. `DISCORD_TOKEN` takes precedence.
- `CLIENT_ID`: Discord application ID; used by command registration and website OAuth.
- `CLIENT_SECRET`: Discord application secret for the server-side OAuth token exchange.
- `MONGODB_URI`: MongoDB Atlas URI. Atlas network access and a database user with read/write access are required. The application explicitly selects database `TACTIOPBOT`, regardless of a database name in the URI.
- `PORT`: HTTP listen port, supplied by most deployment platforms.
- `DISCORD_OAUTH_REDIRECT_URI`: exact Discord-registered callback URL ending `/auth/discord/callback`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth web-client credentials; keep both server-side.
- `GOOGLE_OAUTH_REDIRECT_URI`: exact Google-registered HTTPS callback ending `/auth/google/callback` in production.
- `GOOGLE_OAUTH_ENABLED=true`: enable the Google button only after the credentials and exact callback URL have been configured in Google Cloud Console. Without this explicit flag, Google sign-in remains unavailable.
- `WEB_SESSION_SECRET`: random secret of at least 32 characters; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM`: authenticated SMTP settings used to deliver six-digit email verification codes and branded test messages. Gmail uses `smtp.gmail.com:587` with `SMTP_SECURE=false`; the mailer requires STARTTLS on this port. These are required for email/password sign-in, email registration, email changes, and password changes. Use a Google App Password, not your regular Google password, and keep it only in private local/deployment environment settings. SMTP credentials are read server-side and never sent to the browser.
- `EMAIL_TEST_ADMIN_EMAILS`: optional comma-separated allowlist for the administrator email-test feature. A test can only be sent by a signed-in account whose email is on this list, and only to that same verified address.
- `NODE_ENV=production`: enables secure session cookies and requires an HTTPS OAuth callback.
- `GUILD_ID`: optional development guild for command registration.
- `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, and `TACTICOOL_API`: optional integrations used by other project features; configure only if those features are enabled.

Do not put any real secret in `.env.example`, source files, or frontend assets.

## Discord OAuth and deployment

In the Discord Developer Portal, configure the application ID and secret and add the exact `DISCORD_OAUTH_REDIRECT_URI`. The website requests `identify`, `email`, and `guilds`; the verified email is required to create a Discord-only website account. For local development a callback may be `http://localhost:3000/auth/discord/callback`; after Deploy Hatch assigns your hostname, set the production URI to `https://<your-deploy-hatch-hostname>/auth/discord/callback` in both the service environment and Discord's registered redirect URLs.

Create a Google OAuth web client and register the exact callback URI `http://localhost:3000/auth/google/callback` for local development or `https://<your-deploy-hatch-hostname>/auth/google/callback` after deployment. Set `GOOGLE_OAUTH_REDIRECT_URI` to the exact production URI and add that same URI in Google Cloud Console. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WEB_SESSION_SECRET` (at least 32 characters), and `GOOGLE_OAUTH_ENABLED=true` on the server. The application validates OAuth state, nonce, PKCE, the ID-token signature/audience, and Google's verified-email claim. It does not enable sign-in when configuration is partial. The browser displays Google sign-in as unavailable until the complete configuration is present. Do not put Google credentials in frontend code.

The [Procfile](../Procfile) starts the existing combined bot-and-web process with `npm start`; the package requires Node.js 20.8 or newer to satisfy `connect-mongo` 6. In Deploy Hatch, configure the variables above in the service's environment settings, use the existing Procfile/start command, and set `NODE_ENV=production`. Add the production callback URL to the Discord application. Allow the deployment host in Atlas Network Access and use a least-privilege database user.

The supported topology is a same-origin website and API, usually behind one reverse proxy. The server trusts one proxy hop in production for secure cookies. CORS is intentionally not enabled. If the frontend is deployed on a separate origin, place it behind a same-origin reverse proxy rather than broadening CORS or weakening cookie policy. A cross-site deployment would require a separately reviewed origin allowlist, credentialed CORS, and `SameSite=None; Secure` cookies.

The current `npm start`/Procfile runs the bot, API, and frontend together. If the bot and website backend are later split into separate Deploy Hatch services, configure the same Atlas URI on each server-side service, keep credentials in each service's private variables, and allow both service egress addresses in Atlas. The browser still talks to the website backend only; the Discord bot token and MongoDB URI must never be copied to the frontend. Use a shared same-origin reverse-proxy route for the site and API; this repository does not enable cross-origin credentialed requests.

## Website and API

OAuth access and refresh tokens and session IDs are stored server-side in MongoDB, never returned to browser JavaScript. Session data in MongoDB is encrypted with AES-256-GCM using a key derived from `WEB_SESSION_SECRET`; existing plaintext sessions remain readable during the transition and are encrypted when next saved. Session cookies are HTTP-only, SameSite=Lax, and Secure in production. Authentication endpoints and API requests are rate-limited. Users can register with email/password (scrypt password hashes), Google, or Discord. Email/password registration is completed only after a six-digit code is confirmed; password sign-in requires a new emailed code on each login. Verification codes are cryptographically generated, stored only as keyed hashes in the server-side MongoDB session, expire after 10 minutes, and allow at most five guesses. Resend requests have a 60-second cooldown and an eight-per-15-minute limit. Unverified sessions cannot access dashboard routes or APIs. Changing an account email requires codes sent first to the current address and then to the new address. Password changes also require a code sent to the current address. Google/Discord sign-in relies on their verified provider identity. Name and clan name can be changed in profile settings without a code. All accounts must have a clan name before accessing dashboard routes; OAuth users without one are directed to profile completion. Clan names are user-provided and are not verified against Tacticool. Accounts are never silently linked by matching email: a collision requires signing in with the existing method and explicitly connecting Discord.

- `POST /auth/register` and `POST /auth/register/verify`: request an email code and complete an email/password account with full name and clan name.
- `POST /auth/login` and `POST /auth/login/verify`: validate an email/password pair and complete sign-in with a six-digit email code.
- `POST /auth/register/resend` and `POST /auth/login/resend`: resend a pending verification code, subject to cooldown and rate limits.
- `POST /api/admin/email/test`: send an HTML-branded SMTP test message to the signed-in allowlisted administrator's own verified email address.
- `POST /api/profile/email/code`, `/api/profile/email/verify`: verify the current address and then the new address before changing email.
- `POST /api/profile/password/code`, `/api/profile/password/verify`: request and confirm a code before changing the account password.
- `GET /auth/discord`: start Discord sign-in; use `?link=1` to connect Discord to the currently signed-in website account.
- `GET /auth/discord/callback`: validate state, exchange the code, retrieve the verified Discord profile, and sign in or explicitly link that Discord identity.
- `GET /auth/providers`: report which provider configurations are ready, without exposing credentials.
- `GET /auth/google` and `GET /auth/google/callback`: begin and complete Google sign-in when explicitly enabled and fully configured.
- `POST /auth/logout`: end the session; same-origin only.
- `GET /api/me`: current website account and, when connected, Discord user.
- `PUT /api/profile`: update the signed-in user's clan name.
- `GET /profile/complete`: collect the required clan name after OAuth sign-in.
- `GET /api/languages`: supported notification languages.
- `GET /api/guilds`: manageable Discord servers and current settings.
- `GET /api/guilds/:guildId/resources`: text channels where the bot can send messages and selectable server roles.
- `GET /api/guilds/:guildId/clan-mission-notification`: read authorized server settings.
- `PUT /api/guilds/:guildId/clan-mission-notification`: create/update settings. Supported JSON fields are `channelId`, `roleId` (or `null`), `enabled`, and `language`; omitted fields keep their existing value. A new setting requires `channelId`.
- `DELETE /api/guilds/:guildId/clan-mission-notification`: delete authorized server settings.

The backend verifies submitted channel and role IDs against the selected Discord server. The browser never supplies a database credential or static API key.

## MongoDB collections and indexes

- `cm_notification_settings`: one document per guild; the Discord guild ID is the document `_id`, which MongoDB uniquely indexes automatically. The `guildId` field matches `_id` for use by the bot and API.
- `web_sessions`: server-side website sessions, including OAuth tokens. `connect-mongo` manages the TTL index and expires sessions after eight hours.
- `web_accounts`: email/password and OAuth website accounts, profile names, clan names, and optional linked provider IDs. Passwords are stored only as scrypt hashes. The application creates unique indexes for normalized email, Google subject, and Discord ID when the first account operation occurs.

`npm run test:db` pings the explicitly selected database and lists the number of notification settings after migration verification. The settings collection uses MongoDB's built-in unique `_id` index; no separate index is required for its key lookup.

## Legacy notification migration

On the first notification-data access after MongoDB connects, the bot reads `data/clanMissionNotifications.json`, whose structure is `{ "guilds": { "<guildId>": { ...settings } } }`. Each guild ID becomes the MongoDB document `_id`. The migration imports with `$setOnInsert`, reads every document back, and verifies every source field. Existing MongoDB documents are not overwritten; a mismatch stops migration and leaves the JSON intact. The import is safe to retry after a partial import and across concurrent bot instances. If the JSON has no guild entries, the verifier reports zero; no settings are claimed as migrated.

Keep the JSON file as the rollback source until an operator has independently checked the reported count and records in Atlas. To roll back code, stop the service, redeploy the previous version, and restore the JSON-based implementation only if it still matches the retained file; do not delete or overwrite MongoDB documents as part of rollback.

## Checks and troubleshooting

- `npm test`: offline migration, data-access, scheduler, command-schema, Google/Discord OAuth, account-linking, CSRF, and provider-configuration tests.
- `npm run test:db`: live Atlas pings for both the bot and website clients, plus legacy import/read-back verification. It performs reads and safe idempotent imports; it does not delete production records.
- `GET /health/db`: reports connection status without returning credentials.

If the ping fails or times out, verify the server-side `MONGODB_URI`, Atlas IP access list, database username/permissions, and deployment egress. DNS resolution and an open TCP port do not guarantee that MongoDB server selection and its handshake will complete. Connection errors are logged without printing credentials, and database-dependent requests receive `503` while retries continue. If website OAuth reports that it is not configured, set the redirect URI and generate a new 48-byte `WEB_SESSION_SECRET`. If sign-in works but no settings can be managed, verify the user's live server permissions and that TACTIOPBOT is installed in that server.
