import { createRoot } from "react-dom/client"
import { App } from "./App"

// biome-ignore lint/style/noNonNullAssertion: #root is in index.html
createRoot(document.getElementById("root")!).render(<App />)
