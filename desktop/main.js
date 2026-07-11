// The Electron main process. ovr's electron kind injects ELECTRON_RENDERER_URL — the app's live
// Vite dev server — so the desktop window shows the exact same React app, with HMR, and its /api
// calls proxy to the API. If ovr allocated a remote-debugging port (devtools: true), Electron
// honors it so chrome-devtools can attach.
const { app, BrowserWindow } = require("electron")

const RENDERER = process.env.ELECTRON_RENDERER_URL || "http://localhost:5173"
const DEBUG_PORT = process.env.ELECTRON_REMOTE_DEBUGGING_PORT
if (DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", DEBUG_PORT)

function createWindow() {
	const win = new BrowserWindow({ width: 720, height: 900, title: "ovr guestbook" })
	win.loadURL(RENDERER)
	console.log(`desktop window → ${RENDERER}`)
}

app.whenReady().then(createWindow)
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
app.on("window-all-closed", () => app.quit())
