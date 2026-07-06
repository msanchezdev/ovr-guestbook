// The whole dev environment, as code. One `ovr run` boots both services — on ports it
// picks for you, wired to each other, with data + a signing key that persist across restarts.
import { defineConfig, waitHttp } from "@override-dev/cli"

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
