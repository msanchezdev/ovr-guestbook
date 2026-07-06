# 📖 ovr guestbook

A tiny two-service app that shows what [Override (`ovr`)](https://www.npmjs.com/package/@override-dev/cli) does:
**one command boots your whole local stack — wired together, on ports it picks, with state that persists.**

```bash
npm install
npx ovr run
```

That's it. `ovr` will:

- **auto-onboard** this folder into a workspace (no setup, no config server)
- start **two services** — `api` and `web` — each on a **free port it allocates** (no port collisions, ever)
- **wire them together**: `web` gets the API's URL automatically (a cross-service ref), and waits until the API is healthy before starting
- **provision + remember** the API's data dir and its signing key — so your guestbook entries and their signatures **survive restarts**

Open the `web` URL it prints, sign the guestbook, then quit and `npx ovr run` again — your entries are still there, still verified.

## What to look at

Everything lives in **`ovr.config.mts`** — ~30 lines that declare the environment. Notice:

- `ports.alloc()` — no hardcoded ports
- `paths.get("db")` — a sticky data dir
- `keys.pair("entries")` — a sticky signing keypair (native crypto, zero deps)
- `workspace.services.api.url` — the frontend auto-discovering the backend
- `ready: waitHttp(...)` — health-gated startup

The two servers (`api/server.mjs`, `web/server.mjs`) are plain zero-dependency Node — the interesting part is how `ovr` runs and connects them.
