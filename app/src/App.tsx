import { type FormEvent, useEffect, useState } from "react"

// Injected by Vite from the .env's GUESTBOOK_TITLE (see vite.config.ts).
declare const __TITLE__: string

type Entry = { name: string; message: string; at: string; sig: string; hasImage?: boolean }

export function App() {
	const [entries, setEntries] = useState<Entry[]>([])
	const [name, setName] = useState("")
	const [message, setMessage] = useState("")
	const [image, setImage] = useState<string | null>(null) // a data: URL, read from the file input

	const load = () =>
		fetch("/api/entries")
			.then((r) => r.json())
			.then(setEntries)
			.catch(() => {})

	useEffect(() => {
		load()
		const t = setInterval(load, 2000) // the worker pool processes async; poll to see updates
		return () => clearInterval(t)
	}, [])

	const pickImage = (file?: File) => {
		if (!file) return setImage(null)
		const reader = new FileReader()
		reader.onload = () => setImage(reader.result as string)
		reader.readAsDataURL(file)
	}

	const submit = async (e: FormEvent) => {
		e.preventDefault()
		if (!name || !message) return
		await fetch("/api/entries", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name, message, image }),
		})
		setName("")
		setMessage("")
		setImage(null)
		load()
	}

	return (
		<main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem", font: "16px/1.5 system-ui, sans-serif" }}>
			<h1 style={{ letterSpacing: "-.02em" }}>{__TITLE__}</h1>
			<p style={{ opacity: 0.6, marginTop: "-.6rem" }}>every entry is signed by this environment · notified by the worker pool</p>
			<form onSubmit={submit} style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", margin: "1.5rem 0" }}>
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder="your name" style={{ flex: 0.5, padding: ".55rem .7rem", borderRadius: ".5rem", border: "1px solid #8884" }} />
				<input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="say something…" style={{ flex: 1, padding: ".55rem .7rem", borderRadius: ".5rem", border: "1px solid #8884" }} />
				<button type="submit" style={{ padding: ".55rem .9rem", borderRadius: ".5rem", border: 0, background: "#6c5ce7", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
					sign it
				</button>
				<input type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0])} style={{ flexBasis: "100%", fontSize: ".85rem", opacity: 0.7 }} />
			</form>
			{entries.length === 0 && <p style={{ opacity: 0.55 }}>no entries yet — be the first.</p>}
			{entries.map((e) => (
				<div key={`${e.at}:${e.sig}`} style={{ padding: ".8rem 0", borderTop: "1px solid #8882" }}>
					<b>{e.name}</b> — {e.message}
					{e.hasImage && (
						<div style={{ marginTop: ".5rem" }}>
							<img src={`/api/image/${e.sig}`} alt="" style={{ maxWidth: "100%", maxHeight: 280, borderRadius: ".5rem" }} />
						</div>
					)}
					<div style={{ opacity: 0.55, fontSize: ".8rem", marginTop: ".3rem" }}>
						{e.at} · <span style={{ fontFamily: "ui-monospace, monospace", background: "#6c5ce722", color: "#6c5ce7", padding: "0 .35rem", borderRadius: ".35rem" }}>✓ {e.sig}</span>
					</div>
				</div>
			))}
		</main>
	)
}
