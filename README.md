# Local First Reports

A small Phoenix application with an Ash `Reporting` domain, a SQLite-backed `Report` resource, and a report form running **in the browser in Elixir** through [LocalLiveView](https://local-live-view.hexdocs.pm/welcome.html). Styling uses default daisyUI light/dark themes.

## Run

LocalLiveView 0.1.0 uses Popcorn 0.3.3, which requires **Erlang/OTP 26.0.2 and Elixir 1.17.3**. These are pinned in `.tool-versions`; newer toolchains cannot build this runtime. The AST helper used by its generator is also pinned for compatibility.

```sh
asdf install
mix local.hex --force
mix local.rebar --force
mix setup
mix phx.server
```

Open http://localhost:4000. Node is only needed for the JavaScript/browser tests; application assets are built with Mix.

## Try offline mode

1. Open the app online once and wait for **Ready for offline use**.
2. Switch the browser network to Offline (or disconnect the machine).
3. Create reports, edit their content/status, and delete them with confirmation.
4. Reload while offline. Saved reports and queued changes remain available, and the form still works.
5. Reconnect. The pending count reaches zero once the changes are committed to SQLite.

The timestamp defaults to the current time and is editable in **UTC**. Status is `draft`, `submitted`, or `resolved`. Title and description are required (200 and 10,000 character limits).

## How it works

- `local/lib/reports_local.ex` handles form events and renders HEEx inside the browser's AtomVM/WebAssembly runtime. The Phoenix LiveView at `/` hosts it when online; `/offline` provides a hostless shell for offline startup.
- IndexedDB stores reports and an ordered mutation outbox in the same transaction. The UI confirms a save only after that transaction commits. Unsaved form input is not persisted across reloads.
- A small JavaScript adapter provides browser storage, UUIDs, and HTTP sync. Ash and SQLite run on the server; they are not compiled into the browser.
- Successful Ash create, update, and delete actions broadcast through Phoenix PubSub. A dedicated Phoenix Channel at `/reports_socket` pushes the changed report to other browsers immediately, including browsers running the cached hostless shell. No page refresh or polling is needed for live updates. Offline edits become visible to other users when they commit to the server after reconnecting.
- Incoming events are persisted in IndexedDB and merged by report version. Duplicate/older messages and stale HTTP snapshots cannot roll back newer data; unsynced edits and open forms are preserved.
- Channel join/rejoin triggers catch-up for updates missed while disconnected. Outbox sync also retries on reconnect, every 15 seconds while the app is open, or with **Sync now**. A Web Lock permits only one sync sender per browser origin across tabs, with requests coalesced rather than dropped during an active sync.
- Mutation UUIDs make retries safe. Report versions detect conflicting edits, including edits made while an old form remains open. Choose **Keep my version** or **Use server version** to resolve a conflict. Deletions retain tombstones so stale clients cannot silently restore deleted reports.
- A Capacitor Android client packages the offline shell. Android WebView cannot enable `SharedArrayBuffer`, so the APK uses an HTML fallback UI with the same IndexedDB store and `/api/mobile/v1` sync. Set your Coolify base URL in **Sync server** inside the app.


This is a shared demo without accounts: browsers accessing the same server see the same reports. Browser storage is per origin/device; clearing site data removes local reports and unsynced changes. Offline startup requires a completed initial online visit, a browser with WebAssembly, IndexedDB, Web Locks, and service workers, and HTTPS or localhost. Sync resumes when the app is open, not as a background process after closing the browser.

## Development and deployment

After changing browser Elixir, rebuild both the WASM bundle and offline asset manifest:

```sh
mix llv.build
mix assets.build
```

The development watcher rebuilds browser Elixir, but run the commands above to refresh the offline cache manifest as well. During active development, DevTools → Application → Service Workers → Bypass for network avoids testing against an older installed cache. Disable bypass for offline tests.

`mix assets.deploy` also builds the WASM bundle and generates the offline manifest. Production requires the usual Phoenix `SECRET_KEY_BASE`, `PHX_HOST`, and a writable persistent `DATABASE_PATH` for SQLite. Run migrations before starting the release. Preserve the endpoint's `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers through any proxy, including on static assets and cached HTML.

## Deploy with Docker / Coolify

The repo includes a multi-stage `Dockerfile` (Elixir 1.17.3 / OTP 26.0.2) and `docker-compose.yml`.

Required environment variables:

| Variable | Example |
|----------|---------|
| `SECRET_KEY_BASE` | output of `mix phx.gen.secret` |
| `PHX_HOST` | `your-app.example.com` (your Coolify hostname) |
| `DATABASE_PATH` | `/data/local_first.db` (default in the image) |
| `PHX_SERVER` | `true` |
| `PORT` | `4000` |
| `GOTIFY_URL` | `https://gotify.example.com` (optional; omit to disable) |
| `GOTIFY_APP_TOKEN` | application token from Gotify (required with `GOTIFY_URL`) |
| `GOTIFY_PRIORITY` | `5` (optional Gotify priority, default `5`) |

When `GOTIFY_URL` and `GOTIFY_APP_TOKEN` are set, soft-deleting a report POSTs a message to Gotify so phones with the Gotify app subscribed to that application receive a native notification. Create an **Application** in Gotify, copy its token into Coolify, and leave the vars unset in environments where you do not want push.

Local compose (set a secret first):

```sh
export SECRET_KEY_BASE="$(mix phx.gen.secret)"
export PHX_HOST=your-app.example.com
docker compose up --build
```

Coolify notes:

- Build from the Dockerfile at the repo root.
- Mount a persistent volume at `/data` for SQLite.
- Point health checks at `/healthz` (excluded from `force_ssl` redirects).
- Do **not** strip `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`.
- Example host only: `https://your-app.example.com` — this URL is **not** baked into the Android APK.

## Android app (Capacitor)

The offline shell is packaged as a Capacitor Android app. Reports stay on-device in IndexedDB; when online, the app syncs to `{your Coolify URL}/api/mobile/v1/reports`.

**Important:** Android WebView cannot enable `SharedArrayBuffer`, which LocalLiveView’s AtomVM runtime requires. The APK therefore uses an HTML fallback UI with the **same** offline store and sync behavior. Desktop/browser users still get LocalLiveView via the Phoenix app.

Build a debug APK (JDK 17 or 21 recommended; set `JAVA_HOME` if your default JDK is newer):

```sh
export JAVA_HOME=/usr/lib/jvm/java-21-temurin-jdk   # example on Fedora
export PATH="$JAVA_HOME/bin:$PATH"
npm ci
npm run mobile:prepare
npm run mobile:apk
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Install with:

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

On the phone:

1. Open **Local View**.
2. In **Sync server**, enter your Coolify base URL (for example `https://your-app.example.com`) and Save.
3. Create reports offline; use **Sync now** when the server is reachable.

After changing browser Elixir or assets, run `npm run mobile:prepare` before rebuilding the APK. HTTP LAN URLs need Android cleartext configuration; prefer HTTPS Coolify URLs.

## Checks

```sh
mix precommit
npm ci
npm test
npx playwright install chromium
npm run test:e2e
```

Browser tests start a separate server on port 4002 with `local_first_e2e.db`; they do not write to the development database. Run `mix setup` before the browser suite to build all runtime assets. Tests cover offline CRUD, reload, reconnection, mobile layout, Ash validation, retry safety, conflict handling, and real-time delivery between independent browser sessions. The PubSub browser test blocks the observer’s HTTP sync endpoints to prove changes arrive over the channel, then verifies catch-up after a disconnect and preservation of an open draft.
