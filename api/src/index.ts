// The guestbook API — Elysia (on Node). ovr hands it, via env: a PORT, a signing key, an admin
// token, the CORS allowlist file (kept current by ovr's discovery), and the Redis URL. Entries
// live in Redis (shared by both frontends); every new entry is enqueued as a BullMQ "notify" job
// for the worker pool.
import { sign as cryptoSign } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { node } from "@elysiajs/node"
import { Queue } from "bullmq"
import { Elysia } from "elysia"
import { Redis } from "ioredis"

const PORT = Number(process.env.PORT ?? 3000)
const SIGN_KEY = process.env.SIGN_KEY //         PEM private key (keys.pair)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN //   generated secret (secrets.get)
const ORIGINS_FILE = process.env.ORIGINS_FILE // written by ovr's discovery reconcile
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379"
const STORAGE_URL = process.env.STORAGE_URL //   MinIO S3 endpoint (image branch)
const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? "guestbook"

const url = new URL(REDIS_URL)
const connection = { host: url.hostname, port: Number(url.port) || 6379 }
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
const notify = new Queue("notify", { connection })

// Object storage (MinIO, S3-compatible). Only wired when STORAGE_URL is present (the image branch
// adds the `storage` service). forcePathStyle: MinIO serves buckets as path segments, not subdomains.
const s3 = STORAGE_URL
	? new S3Client({
			endpoint: STORAGE_URL,
			region: "us-east-1",
			forcePathStyle: true,
			credentials: { accessKeyId: process.env.STORAGE_KEY ?? "minio", secretAccessKey: process.env.STORAGE_SECRET ?? "minio12345" },
		})
	: null
// Ensure the bucket exists (idempotent — ignore "already owned").
if (s3) s3.send(new CreateBucketCommand({ Bucket: STORAGE_BUCKET })).catch(() => {})

const ENTRIES = "guestbook:entries"

type Entry = { name: string; message: string; at: string; sig: string; hasImage?: boolean }
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
		const { name = "anon", message = "", image } = (body ?? {}) as { name?: string; message?: string; image?: string }
		const entry: Entry = { name, message, at: new Date().toISOString(), sig: sign(`${name}:${message}`) }
		// Optional image: a `data:<type>;base64,<bytes>` URL → stored in object storage under the sig.
		if (image && s3) {
			const m = /^data:(.+?);base64,(.+)$/.exec(image)
			if (m) {
				await s3.send(new PutObjectCommand({ Bucket: STORAGE_BUCKET, Key: entry.sig, Body: Buffer.from(m[2], "base64"), ContentType: m[1] }))
				entry.hasImage = true
			}
		}
		await redis.lpush(ENTRIES, JSON.stringify(entry))
		await notify.add("entry", entry, { removeOnComplete: true, removeOnFail: 50 }) // → worker pool
		console.log(`+ entry from ${name} (sig ${entry.sig})${entry.hasImage ? " +image" : ""} → queued`)
		return entry
	})
	.get("/image/:sig", async ({ params, set }) => {
		if (!s3) {
			set.status = 404
			return "no storage"
		}
		try {
			const obj = await s3.send(new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: params.sig }))
			const bytes = await obj.Body?.transformToByteArray()
			return new Response(bytes, { headers: { "content-type": obj.ContentType ?? "application/octet-stream" } })
		} catch {
			set.status = 404
			return "not found"
		}
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
