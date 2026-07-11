// The guestbook API — Elysia (on Node). ovr hands it, via env: a PORT, a signing key, an admin
// token, the CORS allowlist file (kept current by ovr's discovery), and the Redis URL. Entries
// live in Redis (shared by both frontends); every new entry is enqueued as a BullMQ "notify" job
// for the worker pool.
import { sign as cryptoSign } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { node } from "@elysiajs/node"
import { Queue } from "bullmq"
import { Elysia } from "elysia"
import { Redis } from "ioredis"

const PORT = Number(process.env.PORT ?? 3000)
const SIGN_KEY = process.env.SIGN_KEY //         PEM private key (keys.pair)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN //   generated secret (secrets.get)
const ORIGINS_FILE = process.env.ORIGINS_FILE // written by ovr's discovery reconcile
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379"

const url = new URL(REDIS_URL)
const connection = { host: url.hostname, port: Number(url.port) || 6379 }
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
const notify = new Queue("notify", { connection })

const ENTRIES = "guestbook:entries"

type Entry = { name: string; message: string; at: string; sig: string }
const sign = (msg: string) =>
	SIGN_KEY ? cryptoSign(null, Buffer.from(msg), SIGN_KEY).toString("base64url").slice(0, 10) : "unsigned"
const listEntries = async (): Promise<Entry[]> => (await redis.lrange(ENTRIES, 0, -1)).map((s) => JSON.parse(s))

// The CORS allowlist ovr keeps current via discovery — re-read per request so live reconciles apply.
const allowed = (): string[] => {
	try {
		return ORIGINS_FILE && existsSync(ORIGINS_FILE) ? JSON.parse(readFileSync(ORIGINS_FILE, "utf8")) : []
	} catch {
		return []
	}
}

new Elysia({ adapter: node() })
	// Reflect the request origin only if a frontend announced it (discovery).
	.onRequest(({ request, set }) => {
		const origin = request.headers.get("origin")
		if (origin && allowed().includes(origin)) {
			set.headers["access-control-allow-origin"] = origin
			set.headers["access-control-allow-headers"] = "content-type, x-admin-token"
			set.headers["access-control-allow-methods"] = "GET, POST, DELETE, OPTIONS"
		}
	})
	.options("/*", () => new Response(null, { status: 204 }))
	.get("/health", () => ({ ok: true }))
	.get("/entries", () => listEntries())
	.get("/stats", async () => ({ entries: await redis.llen(ENTRIES), queued: await notify.getWaitingCount() }))
	.post("/entries", async ({ body }) => {
		const { name = "anon", message = "" } = (body ?? {}) as { name?: string; message?: string }
		const entry: Entry = { name, message, at: new Date().toISOString(), sig: sign(`${name}:${message}`) }
		await redis.lpush(ENTRIES, JSON.stringify(entry))
		await notify.add("entry", entry, { removeOnComplete: true, removeOnFail: 50 }) // → worker pool
		console.log(`+ entry from ${name} (sig ${entry.sig}) → queued`)
		return entry
	})
	.delete("/entries", async ({ headers, set }) => {
		if (ADMIN_TOKEN && headers["x-admin-token"] !== ADMIN_TOKEN) {
			set.status = 403
			return { error: "forbidden" }
		}
		await redis.del(ENTRIES)
		console.log("cleared all entries")
		return { cleared: true }
	})
	.listen(PORT, () => console.log(`api listening on :${PORT}  ·  redis ${connection.host}:${connection.port}`))
