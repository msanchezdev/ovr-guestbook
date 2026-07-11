// The worker POOL — a BullMQ Worker with `concurrency: POOL` (from .env), so up to POOL jobs run
// in parallel. ovr's `waitFor` held this until Redis was ready. Each job is a new guestbook entry
// to "notify" about; the artificial delay lets you watch the pool chew through a burst in parallel.
import { Worker } from "bullmq"

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379"
const POOL = Number(process.env.POOL ?? 3)
const url = new URL(REDIS_URL)
const connection = { host: url.hostname, port: Number(url.port) || 6379 }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let active = 0

const worker = new Worker(
	"notify",
	async (job) => {
		const n = ++active
		const { name, message } = job.data as { name: string; message: string }
		console.log(`▶ [${n}/${POOL}] notifying about "${message}" from ${name}…`)
		await sleep(600 + Math.floor(Math.random() * 900)) // pretend to do work (email/webhook/…)
		active--
		console.log(`✓ notified ${name}`)
	},
	{ connection, concurrency: POOL },
)

worker.on("ready", () => console.log(`worker pool ready · concurrency ${POOL} · redis ${connection.host}:${connection.port}`))
worker.on("failed", (job, err) => console.error(`✗ job ${job?.id} failed: ${err.message}`))
