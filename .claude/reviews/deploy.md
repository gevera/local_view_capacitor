# Deployment Validation: local_first (Coolify / Hetzner Docker)

## Summary

**Not production-ready for a fast Coolify build.** The Coolify UI message alone is ambiguous (logs often stay hidden until “Show Debug Logs”), but the Dockerfile is structured to look “stuck” for a long time: NodeSource install, Capacitor `npm ci`, GitHub Mix deps, Tailwind binary download (~113MB), and `mix llv.build` → `popcorn.cook`. Base image tags are valid. Context size after `.dockerignore` is fine (~38MB). Highest-likelihood hang is early **NodeSource / apt**, not a missing Dockerfile file.

## Blockers (Must Fix)

### Unnecessary NodeSource + Capacitor `npm ci` in server image
- **Location**: `Dockerfile:13–17`, `Dockerfile:34–36`
- **Problem**: README states Node is only for JS/browser tests; assets are Mix-built. Build still runs `curl …/setup_22.x | bash`, installs Node 22, then `npm ci --omit=dev` (Capacitor Android/cli). On Coolify/Hetzner this is a common silent hang (apt/gpg/network) and adds minutes of noise before Elixir work.
- **Fix**: Remove NodeSource and `npm ci` from the Dockerfile. Do not `COPY package.json` / `package-lock.json` for the server image.

### `assets.deploy` downloads large tooling with no install/cache step
- **Location**: `mix.exs` (`assets.deploy`), `Dockerfile:36–39`
- **Problem**: Alias runs `tailwind` / `esbuild` without `assets.setup`. First Docker build downloads binaries (Tailwind linux ~113MB locally). No BuildKit cache mounts → every rebuild re-downloads. Looks like a hang with sparse Coolify logs.
- **Fix**: Split RUN layers; add `mix assets.setup` (or `tailwind.install` / `esbuild.install`) in a cached layer; optional BuildKit cache mounts for Hex/`_build`.

### GitHub Mix deps during image build
- **Location**: `mix.exs:60–73` (heroicons, daisyui via `github:`)
- **Problem**: `mix deps.get` clones GitHub (sparse). Rate limits / slow GitHub from Hetzner stall `deps.get` with little UI feedback.
- **Fix**: Prefer Hex-published packages if available, vendor icons/CSS, or pre-fetch with retries; ensure Coolify has outbound GitHub access.

## Warnings

### Coolify “hang” may be UI, not deadlock
- Message `Building docker image started` is normal until Debug Logs are opened. Confirm with Debug Logs / `docker build` on the server before assuming freeze.

### `# syntax=docker/dockerfile:1`
- **Location**: `Dockerfile:1`
- Pulls BuildKit frontend from Docker Hub. Extra registry dependency; rare Coolify hang if Hub is slow.
- **Fix**: Remove the syntax line unless you need a specific frontend feature.

### `llv.build` → `local/` `mix build` → `deps.get` + `popcorn.cook`
- **Location**: `mix.exs:96–101`, `local/mix.exs:42`, `deps/local_live_view/.../llv.build.ex`
- Extra `deps.get` inside `local/` and WASM cook CPU time. Hex LLV ships prebuilt AtomVM JS (`priv/static`); cook still compiles the bundle. Slow, usually not an infinite hang unless network/deps fail.

### `.dockerignore` excludes `Dockerfile` / `docker-compose.yml`
- **Location**: `.dockerignore:25–26`
- Unusual; not a typical hang cause (client still sends Dockerfile). Safe to stop ignoring them for clarity. Does **not** exclude `scripts/`, `local/`, `priv/` (good).

### Single health endpoint vs checklist trio
- **Location**: `router.ex` `/healthz`, `HealthController`
- Coolify-usable readiness (DB `SELECT 1`). No separate startup/liveness paths. OK for Coolify; not k8s-grade.

### Runtime / release gaps (post-build)
- Secrets and `DATABASE_PATH` correctly raised in `config/runtime.exs` under `config_env() == :prod`.
- `PHX_SERVER=true` set in image; `server: true` via runtime when env set. ✅
- No `rel/`, no explicit `releases:` in `mix.exs` — default release usually works; add explicit release config for clarity.
- SQLite: no TLS concerns. Mount `/data` on Coolify (compose does).
- No graceful shutdown / stop timeout documented for Coolify.
- `force_ssl` + `/healthz` exclude present. ✅
- Observability: default logger, no JSON/Sentry — warning only.

## Root-cause hypotheses (ranked)

| Rank | Likelihood | Hypothesis |
|------|------------|------------|
| 1 | **High** | Stuck/slow on NodeSource `curl \| bash` + `apt-get install nodejs` (Coolify shows no step logs until Debug). |
| 2 | **High** | Build is running but UI idle; open Debug Logs — often mid-`deps.get` / Tailwind download / `llv.build`. |
| 3 | **High** | `mix deps.get` stalled on GitHub heroicons/daisyui clones. |
| 4 | **Medium** | `npm ci` Capacitor download/extract (unnecessary for server). |
| 5 | **Medium** | First-time Tailwind/esbuild binary download (~100MB+) without progress in Coolify UI. |
| 6 | **Medium** | Base image pull (`hexpm/elixir:…bookworm-20260824-slim`) on cold cache — tags **exist** on Docker Hub. |
| 7 | **Low** | BuildKit `# syntax=` frontend pull hang. |
| 8 | **Low** | `.dockerignore` excluding needed files — **not observed**; required COPY paths are included. |
| 9 | **Low** | Infinite hang in `mix release` itself — more likely fail-fast than hang if config wrong. |

## Configuration Review

### Runtime Configuration
- Status: ✅
- Secrets in runtime.exs: yes (`SECRET_KEY_BASE`, `DATABASE_PATH`, `PHX_HOST`, `POOL_SIZE`)
- Required env vars validated: yes (`raise` if missing)

### Health Checks
- Status: ⚠️
- Startup: missing (use `/healthz` for Coolify)
- Liveness: missing as separate path
- Readiness: `/healthz` (DB ping)

### Container Configuration
- Status: ⚠️
- Non-root user: yes (`nobody`)
- CPU limits: none in compose (good for BEAM)
- Grace period: not set (Coolify default may be short)
- Multi-stage: yes
- HEALTHCHECK: in compose only (Coolify may ignore compose healthcheck — configure in UI)

### Database
- Status: ✅ (SQLite file)
- SSL: N/A
- Pool size: env-configurable
- Migrations: entrypoint runs `LocalFirst.Release.migrate` before start

### Observability
- Status: ⚠️
- Structured logging: no
- Error tracking: none
- Metrics: telemetry deps present; no deploy dashboards assumed

## Recommended fixes (concrete)

1. **Slim the builder** — drop NodeSource, Node, `npm ci`, and root `package*.json` COPY.
2. **Cache Mix layers** — keep `deps.get`/`deps.compile` separate; add `mix assets.setup` before `assets.deploy`.
3. **Open Coolify Debug Logs** and/or run on the server:
   `docker build --progress=plain -t local_first:test .`
   to see the exact stuck layer.
4. **Optional speedups** — remove `# syntax=…`; vendor or Hex-ify heroicons/daisyui; BuildKit cache mounts for `/root/.hex`, `/root/.mix`, `/app/deps`, `/app/_build`.
5. **Coolify UI** — persistent volume `/data`; health path `/healthz`; preserve COOP/COEP headers; set `SECRET_KEY_BASE`, `PHX_HOST`, `PHX_SERVER=true`, `PORT=4000`.

## Pre-Deploy Checklist
- [ ] Reproduce with `docker build --progress=plain` on the Hetzner host
- [ ] Remove Node/npm from Dockerfile and rebuild
- [ ] Confirm Debug Logs show progress past `apt-get` / `deps.get`
- [ ] All blockers resolved
- [ ] Migrations tested via entrypoint on fresh `/data`
- [ ] Rollback procedure documented
- [ ] Monitoring/alerts configured
