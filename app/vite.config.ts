import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Port + host come from ovr on the CLI (`vite --port … --host 127.0.0.1 --strictPort`); the api
// URL is a cross-service ref ovr injects as API_URL, and the page title comes from the .env
// (GUESTBOOK_TITLE) via ovr's dotenv plugin. `/api/*` is proxied to the api so the browser calls
// it SAME-ORIGIN (which is what makes the api's discovery-driven CORS actually meaningful).
export default defineConfig({
	plugins: [react()],
	define: { __TITLE__: JSON.stringify(process.env.GUESTBOOK_TITLE ?? "📖 guestbook") },
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
