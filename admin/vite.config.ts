import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"

// Port + host come from ovr on the CLI; API_URL is the cross-service ref ovr injects. `/api/*`
// is proxied to the api so the browser calls it same-origin (exercising discovery-driven CORS).
export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			"/api": {
				target: process.env.API_URL ?? "http://localhost:3000",
				changeOrigin: true,
				rewrite: (p) => p.replace(/^\/api/, ""),
			},
		},
	},
})
