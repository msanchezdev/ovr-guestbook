// The whole dev environment, as code. One `ovr run` boots both services — on ports it
// picks for you, wired to each other, with data + a signing key that persist across restarts.
import { action, defineConfig, input, waitHttp } from "@override-dev/cli"

export default defineConfig(({ workspace, kind }) => ({
	services: {
		// The API. `prepare` provisions its resources; the tool remembers them run-to-run.
		api: kind.shell({
			prepare: async ({ ports, paths, keys }) => ({
				port: await ports.alloc(), //     a free port, sticky per service
				data: paths.get("db"), //         a data dir that SURVIVES restarts
				signKey: keys.pair("entries").privateKey, // a stable signing keypair
			}),
			command: ({ port, data }) => `PORT=${port} DATA=${data} node api/server.mjs`,
			env: ({ signKey }) => ({ SIGN_KEY: signKey }), // multiline PEM → via env
			exports: ({ port }) => ({ url: `http://localhost:${port}`, port }),
			ready: ({ port }) => waitHttp(`http://localhost:${port}/health`), // gates `web`

			// TUI actions — press the action key on the `api` service to run these.
			actions: [
				// A JS action with a typed input FORM. `name`/`message` are collected in a native
				// TUI form, then handed to `run` (fully typed). No subprocess — just a fetch.
				action.fn({
					id: "add",
					label: "Add entry…",
					category: "guestbook",
					inputs: { name: input.text("Your name"), message: input.text("Message") },
					run: async ({ inputs, exports, log }) => {
						await fetch(`${exports.url}/entries`, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ name: inputs.name, message: inputs.message }),
						})
						log(`signed an entry from ${inputs.name}`)
					},
				}),
				// Seed a few entries — instant demo content.
				action.fn({
					id: "seed",
					label: "Seed demo entries",
					category: "guestbook",
					run: async ({ exports, log }) => {
						const demo = [
							{ name: "ada", message: "first!" },
							{ name: "grace", message: "one command boots the whole thing 🤯" },
							{ name: "linus", message: "and it persists across restarts" },
						]
						for (const d of demo) {
							await fetch(`${exports.url}/entries`, {
								method: "POST",
								headers: { "content-type": "application/json" },
								body: JSON.stringify(d),
							})
						}
						log(`seeded ${demo.length} entries`)
					},
				}),
				// A confirm input, then wipe. (Data comes back next run only if you re-seed —
				// the store is sticky, but this clears it.)
				action.fn({
					id: "clear",
					label: "Clear guestbook",
					category: "guestbook",
					inputs: { sure: input.confirm("Delete ALL entries?", { default: false }) },
					run: async ({ inputs, exports, log }) => {
						if (!inputs.sure) return log("cancelled")
						await fetch(`${exports.url}/entries`, { method: "DELETE" })
						log("cleared all entries")
					},
				}),
				// A PTY command with `login: true` — runs through your login shell so it sources
				// your profile (~/.zshrc), which is how tools like `bunx` / nvm shims get on PATH.
				// (Without login:true this errors with `execvp: No such file or directory`.)
				action.session({
					id: "format",
					label: "Format code (bunx prettier)",
					category: "dev",
					command: "bunx --yes prettier --write .",
					login: true,
				}),
			],
		}),

		// The web frontend. It doesn't know or care which port the API landed on —
		// this cross-service ref wires it automatically, and `web` waits for the API.
		web: kind.shell({
			prepare: async ({ ports }) => ({ port: await ports.alloc() }),
			command: ({ port }) => `PORT=${port} node web/server.mjs`,
			env: { API_URL: workspace.services.api.url },
			exports: ({ port }) => ({ url: `http://localhost:${port}` }),
		}),
	},
}))
