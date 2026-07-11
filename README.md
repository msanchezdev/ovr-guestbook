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

## Fork it — isolated environments for real work

A **fork** is a throwaway, fully-isolated copy of the environment: its own git worktree (on its own
branch), its own ports, its own Redis, its own URLs. Nothing collides with your main checkout, and you
can tear it down without a trace. Because you're already in this workspace after `ovr run`, you don't
pass a base — just name the fork:

```bash
ovr fork feature-x      # new worktree on branch `feature-x`, active
ovr run                 # boot it — its own Redis, api, worker, URLs
```

Use it for things you don't want touching your main checkout:

- **A change in isolation** — edit the api or worker in the fork's worktree (it's a separate branch),
  run it, throw it away if it doesn't pan out. Your main environment never moved.
- **A config / scale variant, no code change** — fork, then override an env var live and restart:
  ```bash
  ovr inspect guestbook.worker env.POOL=12   # this fork runs a 12-wide pool…
  ovr run                                     # …while your main run stays at POOL=3
  ```
  (or press `i` on `worker` → `env` tab → `e`.) Same code, a different environment.
- **Parallel agents / tickets** — give each its own fork so they never step on each other's ports or
  data. `ovr ps` shows every fork's services across sessions.

### The themed branches (a visual side-by-side demo)

`dark`, `sunset`, and `ocean` are ready-made example branches that just retheme the app's accent, so two
forks are obviously different on screen:

```bash
ovr fork dark    # worktree on the `dark` branch
ovr fork sunset  # …and `sunset`
ovr run -w dark      # one terminal → https://app.dark.localhost
ovr run -w sunset    # another      → https://app.sunset.localhost
```

Each is a complete, independent stack (separate Redis + api + worker pool), on its own portless hostname.
This is the "agents drive fast; don't let them crash" story — many environments in parallel, each sandboxed.
