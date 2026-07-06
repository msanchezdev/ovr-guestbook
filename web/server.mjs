// A zero-dependency web frontend. It never hardcodes where the API is — ovr injects
// API_URL (a cross-service ref) so it's wired automatically to whatever port the API got.
import { createServer } from "node:http"

const PORT = process.env.PORT ?? 8080
const API_URL = process.env.API_URL ?? "http://localhost:3000"

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

const page = (entries) => `<!doctype html><html><head><meta charset="utf8">
<title>ovr guestbook</title><style>
  :root { color-scheme: light dark }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1rem }
  h1 { letter-spacing: -.02em } .sub { opacity: .6; margin-top: -.6rem }
  form { display: flex; gap: .5rem; margin: 1.5rem 0 }
  input, button { font: inherit; padding: .55rem .7rem; border-radius: .5rem; border: 1px solid #8884 }
  input { flex: 1 } input[name=name] { flex: .5 }
  button { cursor: pointer; border: 0; background: #6c5ce7; color: #fff; font-weight: 600 }
  .e { padding: .8rem 0; border-top: 1px solid #8882 }
  .e b { font-weight: 600 } .meta { opacity: .55; font-size: .8rem }
  .sig { font-family: ui-monospace, monospace; background: #6c5ce722; color: #6c5ce7; padding: 0 .35rem; border-radius: .35rem }
</style></head><body>
  <h1>📖 guestbook</h1>
  <p class="sub">every entry is cryptographically signed by this environment</p>
  <form method="POST" action="/">
    <input name="name" placeholder="your name" required>
    <input name="message" placeholder="say something…" required>
    <button>sign it</button>
  </form>
  ${entries.map((e) => `<div class="e"><b>${esc(e.name)}</b> — ${esc(e.message)}<div class="meta">${esc(e.at)} · <span class="sig">✓ ${esc(e.sig)}</span></div></div>`).join("")}
  ${entries.length ? "" : '<p class="meta">no entries yet — be the first.</p>'}
</body></html>`

const body = (req) =>
	new Promise((resolve) => {
		let b = ""
		req.on("data", (c) => (b += c))
		req.on("end", () => resolve(b))
	})

createServer(async (req, res) => {
	if (req.method === "POST") {
		const params = new URLSearchParams(await body(req))
		await fetch(`${API_URL}/entries`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: params.get("name"), message: params.get("message") }),
		})
		res.writeHead(303, { location: "/" }).end()
		return
	}
	const entries = await fetch(`${API_URL}/entries`)
		.then((r) => r.json())
		.catch(() => [])
	res.writeHead(200, { "content-type": "text/html" })
	res.end(page(entries))
}).listen(PORT, () => console.log(`web listening on :${PORT}  ·  api → ${API_URL}`))
