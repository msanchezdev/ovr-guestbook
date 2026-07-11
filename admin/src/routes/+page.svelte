<script lang="ts">
	type Entry = { name: string; message: string; at: string; sig: string }
	let entries = $state<Entry[]>([])
	let stats = $state({ entries: 0, queued: 0 })
	let name = $state("")
	let message = $state("")

	async function load() {
		entries = await fetch("/api/entries").then((r) => r.json()).catch(() => [])
		stats = await fetch("/api/stats").then((r) => r.json()).catch(() => ({ entries: 0, queued: 0 }))
	}
	async function add(e: Event) {
		e.preventDefault()
		if (!name || !message) return
		await fetch("/api/entries", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name, message }),
		})
		name = ""
		message = ""
		load()
	}
	// Destructive "clear" is deliberately NOT here — it needs the generated admin token, which
	// only the ovr `clear` action holds (see the api's actions). The panel is view + add + stats.
	$effect(() => {
		load()
		const t = setInterval(load, 2000)
		return () => clearInterval(t)
	})
</script>

<main>
	<h1>🛠️ guestbook admin</h1>
	<p class="stats">
		<b>{stats.entries}</b> entries · <b>{stats.queued}</b> job(s) queued in the worker pool
	</p>

	<form onsubmit={add}>
		<input bind:value={name} placeholder="name" />
		<input bind:value={message} placeholder="message" />
		<button type="submit">add</button>
	</form>

	{#each entries as e (e.at + e.sig)}
		<div class="entry">
			<b>{e.name}</b> — {e.message}
			<div class="meta">{e.at} · <span class="sig">✓ {e.sig}</span></div>
		</div>
	{:else}
		<p class="meta">no entries yet.</p>
	{/each}
</main>

<style>
	main { max-width: 640px; margin: 4rem auto; padding: 0 1rem; font: 16px/1.5 system-ui, sans-serif }
	h1 { letter-spacing: -.02em }
	.stats { opacity: .7 }
	form { display: flex; gap: .5rem; margin: 1.5rem 0 }
	input { flex: 1; padding: .55rem .7rem; border-radius: .5rem; border: 1px solid #8884 }
	button { padding: .55rem .9rem; border-radius: .5rem; border: 0; background: #e17055; color: #fff; font-weight: 600; cursor: pointer }
	.entry { padding: .8rem 0; border-top: 1px solid #8882 }
	.meta { opacity: .55; font-size: .8rem }
	.sig { font-family: ui-monospace, monospace; background: #e1705522; color: #e17055; padding: 0 .35rem; border-radius: .35rem }
</style>
