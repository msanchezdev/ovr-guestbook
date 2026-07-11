// The whole dev environment, as code. One `ovr run` boots the FULL stack — Redis (Docker), an
// Elysia API, a BullMQ worker pool, and two frontends (a React app + a SvelteKit admin) — on
// ports it picks for you, health-gated, wired together, with keys/secrets that persist, layered
// env from a .env, live service-to-service discovery, and deps auto-installed per repo.
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { action, defineConfig, dotenv, input, waitHttp, waitTcp } from "@ovrdev/cli"
import { docker } from "@ovrdev/plugin-docker"
import { node } from "@ovrdev/plugin-js"
import { portless } from "@ovrdev/plugin-portless"

export default defineConfig(
	{
		plugins: ({ workspace }) => [
			portless({ group: workspace.name }), // stable https://<svc>.<workspace>.localhost per fork
			dotenv(), //                            layer the repo's .env into every service
			docker(), //                            kind.docker.container (Redis)
			node(), //                              ensure node_modules before services start (npm workspaces)
		],
	},
	({ workspace, kind }) => {
		// Shared by the api's `discovery` reconcile (writes it) and the api process (reads it):
		// the live CORS allowlist. Keyed per workspace so forks stay isolated.
		const originsFile = join(tmpdir(), `ovr-guestbook.${workspace.name}.origins.json`)
		const redis = workspace.services.redis
		const storage = workspace.services.storage

		return {
			services: {
				// ── Redis (Docker) ─────────────────────────────────────────────────────────────
				// A container as an ovr service: an auto-allocated host port (sticky), TCP-ready-gated,
				// exporting a connection url the api + worker wire to. Backs both entries and the queue.
				redis: kind.docker.container({
					image: "redis:7-alpine",
					ports: [{ container: 6379 }],
					exports: ({ host, port }) => ({ url: `redis://${host}:${port}`, host, port: String(port) }),
					ready: ({ port }) => waitTcp(port),
				}),

				// ── Object storage (MinIO, Docker) ─────────────────────────────────────────────
				// This whole service exists ONLY on the `image` branch — a fork that changes the
				// environment's TOPOLOGY, not just code. S3-compatible; the api uploads entry images
				// here. `command` (a container arg) needs @ovrdev/plugin-docker ≥ alpha.3.
				storage: kind.docker.container({
					image: "minio/minio",
					command: ["server", "/data", "--console-address", ":9001"],
					ports: [{ container: 9000 }, { container: 9001 }],
					env: { MINIO_ROOT_USER: "minio", MINIO_ROOT_PASSWORD: "minio12345" },
					exports: ({ host, port }) => ({
						url: `http://${host}:${port}`, // the S3 API endpoint
						key: "minio",
						secret: "minio12345",
						bucket: "guestbook",
					}),
					ready: ({ port }) => waitHttp(`http://localhost:${port}/minio/health/live`),
				}),

				// ── API (Elysia, on Node) ──────────────────────────────────────────────────────
				// prepare provisions a port, a signing keypair, and a generated admin token. It waits
				// for Redis to be READY, stores entries in Redis, and enqueues a "notify" job per entry
				// for the worker pool.
				api: kind.shell({
					waitFor: [redis.ready, storage.ready], // both backing services must be up
					prepare: async ({ ports, keys, secrets }) => ({
						port: await ports.alloc(),
						signKey: keys.pair("entries").privateKey, // stable signature per environment
						adminToken: secrets.get("admin-token"), //  generated once, gates destructive ops
					}),
					command: "cd api && tsx watch src/index.ts",
					env: ({ port, signKey, adminToken }) => ({
						PORT: String(port),
						SIGN_KEY: signKey,
						ADMIN_TOKEN: adminToken,
						ORIGINS_FILE: originsFile,
						REDIS_URL: redis.url, //   a cross-service ref → resolved to redis://host:port
						STORAGE_URL: storage.url, // MinIO S3 endpoint + creds + bucket (image branch only)
						STORAGE_KEY: storage.key,
						STORAGE_SECRET: storage.secret,
						STORAGE_BUCKET: storage.bucket,
					}),
					exports: ({ port, adminToken }) => ({ url: `http://localhost:${port}`, port, adminToken }),
					ready: ({ port }) => waitHttp(`http://localhost:${port}/health`), // gates the frontends
					// Discovery: the CORS allowlist, reconciled from the frontends that announced their
					// origin. Run a second fork's app/admin and watch this grow in the api's pane.
					discovery: (announcements, ctx) => {
						const origins = announcements.map((a) => a.payload.origin).filter(Boolean)
						writeFileSync(originsFile, JSON.stringify(origins))
						ctx.log(`🔎 CORS allowlist: ${origins.length ? origins.join(", ") : "(none yet)"}`)
					},
					// Actions grouped into user-defined SECTIONS (by category).
					actions: [
						action.fn({
							id: "add",
							label: "Add entry…",
							category: "guestbook",
							inputs: { name: input.text("Your name"), message: input.text("Message") },
							run: async ({ inputs, exports, log }) => {
								await post(exports.url, { name: inputs.name, message: inputs.message })
								log(`signed + queued an entry from ${inputs.name}`)
							},
						}),
						action.fn({
							id: "seed",
							label: "Seed demo entries",
							category: "guestbook",
							run: async ({ exports, log }) => {
								for (const d of [
									{ name: "ada", message: "first!" },
									{ name: "grace", message: "one command boots the whole stack 🤯" },
									{ name: "linus", message: "redis, api, worker pool, two frontends" },
								])
									await post(exports.url, d)
								log("seeded 3 entries")
							},
						}),
						action.fn({
							id: "clear",
							label: "Clear guestbook",
							category: "admin",
							inputs: { sure: input.confirm("Delete ALL entries?", { default: false }) },
							run: async ({ inputs, exports, log }) => {
								if (!inputs.sure) return log("cancelled")
								await fetch(`${exports.url}/entries`, { method: "DELETE", headers: { "x-admin-token": exports.adminToken } })
								log("cleared all entries")
							},
						}),
						action.fn({
							id: "stats",
							label: "Stats",
							category: "admin",
							run: async ({ exports, log }) => {
								const s = await fetch(`${exports.url}/stats`).then((r) => r.json())
								log(`${s.entries} entries · ${s.queued} job(s) queued`)
							},
						}),
					],
				}),

				// ── Worker pool (BullMQ) ───────────────────────────────────────────────────────
				// Waits for Redis, then runs a pool of N concurrent consumers (POOL from .env) off the
				// "notify" queue. Each job is a new entry to "notify" about — the panes show them
				// processed in parallel.
				worker: kind.shell({
					waitFor: [redis.ready],
					command: "cd worker && tsx watch src/index.ts",
					env: { REDIS_URL: redis.url },
				}),

				// ── App (React + Vite) ─────────────────────────────────────────────────────────
				// The public guestbook. Portless HTTPS URL; Vite proxies /api → the api (so the browser
				// hits the api same-origin, and discovery/CORS is genuinely exercised).
				app: kind.shell({
					prepare: async ({ portless }) => ({ port: await portless.register("app"), url: portless.url("app") }),
					command: ({ port }) => `cd app && vite --port ${port} --host 127.0.0.1 --strictPort`,
					env: { API_URL: workspace.services.api.url },
					exports: ({ url, port }) => ({ url, port }),
					announce: ({ url }) => [workspace.services.api.announce({ origin: url })],
				}),

				// ── Admin (SvelteKit) ──────────────────────────────────────────────────────────
				// A second frontend: manage entries + watch the queue. Same wiring, different framework.
				admin: kind.shell({
					prepare: async ({ portless }) => ({ port: await portless.register("admin"), url: portless.url("admin") }),
					// `svelte-kit sync` generates .svelte-kit/ (types + tsconfig) before dev — idempotent.
					command: ({ port }) => `cd admin && svelte-kit sync && vite dev --port ${port} --host 127.0.0.1 --strictPort`,
					env: { API_URL: workspace.services.api.url },
					exports: ({ url, port }) => ({ url, port }),
					announce: ({ url }) => [workspace.services.api.announce({ origin: url })],
				}),
			},
		}
	},
)

/** Tiny POST helper shared by the guestbook actions. */
async function post(base: string, entry: { name: string; message: string }) {
	await fetch(`${base}/entries`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(entry),
	})
}
