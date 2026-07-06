// A zero-dependency JSON API for the guestbook.
// ovr hands it, via env: a PORT, a sticky DATA dir (survives restarts), and a private
// SIGN_KEY (a stable keypair) — this file just uses them.
import { createServer } from "node:http"
import { sign as cryptoSign } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PORT = process.env.PORT ?? 3000
const DATA = process.env.DATA ?? "."
const SIGN_KEY = process.env.SIGN_KEY // PEM private key, provisioned by ovr (keys.pair)
const FILE = join(DATA, "guestbook.json")

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [])
const save = (entries) => writeFileSync(FILE, JSON.stringify(entries, null, 2))

// A short verification tag — proof the entry was signed by THIS environment's key.
const sign = (msg) => (SIGN_KEY ? cryptoSign(null, Buffer.from(msg), SIGN_KEY).toString("base64url").slice(0, 10) : "unsigned")

const body = (req) =>
	new Promise((resolve) => {
		let b = ""
		req.on("data", (c) => (b += c))
		req.on("end", () => resolve(b))
	})

createServer(async (req, res) => {
	const json = (code, data) => {
		res.writeHead(code, { "content-type": "application/json" })
		res.end(JSON.stringify(data))
	}
	if (req.url === "/health") return json(200, { ok: true })
	if (req.url === "/entries" && req.method === "GET") return json(200, load())
	if (req.url === "/entries" && req.method === "POST") {
		const { name = "anon", message = "" } = JSON.parse((await body(req)) || "{}")
		const entry = { name, message, at: new Date().toISOString(), sig: sign(`${name}:${message}`) }
		const entries = load()
		entries.unshift(entry)
		save(entries)
		console.log(`+ entry from ${name} (sig ${entry.sig})`)
		return json(201, entry)
	}
	json(404, { error: "not found" })
}).listen(PORT, () => console.log(`api listening on :${PORT}  ·  data → ${FILE}`))
