# 📖 ovr guestbook

A full-stack guestbook that shows what [Override (`ovr`)](https://www.npmjs.com/package/@ovrdev/cli) does:
**one command boots your whole local stack — Redis, an API, a worker pool, and two frontends — wired
together, on ports it picks, health-gated, with deps installed for you.**

```bash
npm install     # or let ovr's node() plugin do it on first run
npx ovr run
```

**Prerequisites:** [Docker](https://www.docker.com/) running (for Redis). Everything else is Node.

That one command:

- **auto-onboards** this folder into a workspace (no setup step)
- boots **five services**, each on a **free port it allocates** — no collisions, ever:

  | service | stack | role |
  | --- | --- | --- |
  | **redis** | `redis:7-alpine` (Docker) | shared state + the job queue |
  | **api** | [Elysia](https://elysiajs.com) (Node) | signs entries, stores them in Redis, enqueues a job per entry |
  | **worker** | [BullMQ](https://bullmq.io) pool | N concurrent consumers processing the queue |
  | **app** | React + Vite | the public guestbook |
  | **admin** | SvelteKit | manage entries + watch the queue |

- **wires them together** with cross-service refs (the api gets Redis's URL; the frontends get the
  api's URL) and **health-gates** startup — the api/worker wait until Redis is *ready*, the frontends
  wait until the api is *ready*.
- gives each frontend a **stable HTTPS URL** via [portless](https://www.npmjs.com/package/@ovrdev/plugin-portless)
  (`https://app.<workspace>.localhost`, `https://admin.<workspace>.localhost` — per-workspace, so every
  fork gets its own). Start the proxy from the TUI's `all` tab → "portless: start proxy".

## What each capability looks like

Everything lives in **`ovr.config.mts`**. Notice:

- **`kind.docker.container`** — Redis as an ovr service (`@ovrdev/plugin-docker`)
- **`node()`** — deps auto-installed per repo before services start (`@ovrdev/plugin-js`, npm workspaces)
- **`dotenv()`** — the `.env` (`GUESTBOOK_TITLE`, `POOL`) layered into every service
- **`ports.alloc()` / `keys.pair()` / `secrets.get()`** — sticky port, signing keypair, and a generated
  admin token that survive restarts (the token gates the destructive `clear` action — a secret only the
  ovr action holds)
- **`waitFor` + `ready`** — real readiness gating across the whole graph
- **`announce` / `discovery`** — each frontend announces its origin; the api reconciles them into a live
  **CORS allowlist** (watch it grow in the api's pane when you run a second fork). Vite proxies `/api` →
  the api, so the browser calls it same-origin and the allowlist is genuinely exercised.
- **actions in sections** — press the action key on `api`: the actions are grouped into user-defined
  sections (`guestbook`, `admin`) in the panel.

## Try it in the TUI

- Press **`.`** on `api` → run **Add entry…** or **Seed demo entries**; watch the **worker** pane process
  the queued jobs in parallel (`[1/3] … [2/3] …`).
- Press **`i`** on any service → inspect its **exports / ports / env / secrets**. On the `env` tab press
  **`e`** to change a value live (e.g. bump `POOL`), then **`r`** to restart and apply.
- `ovr inspect api env` from a shell prints the same, scriptably.

Open the **app** URL, sign the guestbook, then quit and `npx ovr run` again — your entries persist (Redis
volume) and every entry is still signed by this environment's key.

## Fork it — isolated stacks, side by side

The point of forking: run several **complete, isolated** copies of the stack at once — each on its own
branch, in its own workspace, with its own ports, its own Redis, and its own URLs. No collisions, nothing
to hand-manage.

```bash
ovr fork dark   --from ovr-guestbook   # a workspace on the `dark` branch
ovr fork sunset --from ovr-guestbook   # …and the `sunset` branch

ovr run -w dark      # one terminal
ovr run -w sunset    # another
```

The `dark`, `sunset`, and `ocean` branches each retheme the app's accent, so the two windows are obviously
different — `https://app.dark.localhost` vs `https://app.sunset.localhost` (portless groups routes by
workspace, so every fork gets its own hostname). Each fork runs a *separate* Redis + api + worker pool, so
their guestbooks are fully independent. `ovr ps` shows them all. This is the "agents drive fast; don't let
them crash" story — many environments in parallel, each sandboxed.
