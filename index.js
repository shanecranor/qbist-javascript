import { createInfo, modifyInfo, optimize } from "./qbist.js"
import { loadStateFromParam } from "./qbistListeners.js"

// UI Elements
const loadingOverlay = document.getElementById("loadingOverlay")
const loadingBar = document.getElementById("loadingBar")
loadingOverlay.style.display = "none"

// Renderer Management
class QbistRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.worker = null
    this.isInitialized = false
    this.keepAlive = false
    this._setupWorker()
  }

  _setupWorker() {
    if (typeof Worker === "undefined") {
      throw new Error("Web Workers are not supported in this browser")
    }

    // Cleanup existing worker if any
    this.cleanup()

    this.worker = new Worker("workerWebGL.js", { type: "module" })
    this.worker.onerror = (err) => {
      console.error("Worker error:", err)
      this.cleanup()
    }
  }

  cleanup() {
    if (this.worker) {
      this.worker.postMessage({ type: "cleanup" })
      this.worker = null
    }
    this.isInitialized = false
    this.keepAlive = false
  }

  async render(info, options = {}) {
    const { keepAlive = false, isExport = false } = options
    this.keepAlive = keepAlive

    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this._setupWorker()
      }

      const onMessage = (e) => {
        if (e.data.command === "rendered") {
          if (!this.keepAlive) {
            this.worker.removeEventListener("message", onMessage)
          }
          if (isExport) {
            loadingOverlay.style.display = "none"
          }
          resolve(e.data)
        } else if (e.data.command === "error") {
          this.worker.removeEventListener("message", onMessage)
          reject(new Error(e.data.message))
        }
      }

      this.worker.addEventListener("message", onMessage)

      try {
        if (isExport) {
          loadingOverlay.style.display = "flex"
          loadingBar.style.width = "100%"
        }

        if (!this.isInitialized) {
          // Initial setup - transfer the canvas
          const offscreen = this.canvas.transferControlToOffscreen()
          this.worker.postMessage(
            {
              type: "init",
              canvas: offscreen,
              info,
              keepAlive: this.keepAlive,
            },
            [offscreen]
          )
          this.isInitialized = true
        } else {
          // Just update the info for subsequent renders
          this.worker.postMessage({
            type: "update",
            info,
            keepAlive: this.keepAlive,
          })
        }
      } catch (err) {
        this.worker.removeEventListener("message", onMessage)
        reject(err)
      }
    })
  }

  update(info) {
    if (this.worker) {
      this.worker.postMessage({
        type: "update",
        info,
        keepAlive: this.keepAlive,
      })
    }
  }
}

// Export Management
class QbistExporter {
  constructor() {
    this.exportCanvas = null
    this.renderer = null
  }

  cleanup() {
    if (this.renderer) {
      this.renderer.cleanup()
      this.renderer = null
    }
    if (this.exportCanvas && this.exportCanvas.parentNode) {
      document.body.removeChild(this.exportCanvas)
      this.exportCanvas = null
    }
  }

  async exportImage(info, width, height) {
    try {
      this.cleanup()

      this.exportCanvas = document.createElement("canvas")
      this.exportCanvas.id = "exportCanvas"
      this.exportCanvas.width = width
      this.exportCanvas.height = height
      document.body.appendChild(this.exportCanvas)

      this.renderer = new QbistRenderer(this.exportCanvas)
      const result = await this.renderer.render(info, { isExport: true })

      if (result.kind === "bitmap") {
        const link = document.createElement("a")
        const tempCanvas = document.createElement("canvas")
        tempCanvas.width = width
        tempCanvas.height = height

        const ctx = tempCanvas.getContext("2d")
        ctx.drawImage(result.bitmap, 0, 0)

        link.href = tempCanvas.toDataURL("image/png")
        link.download = "qbist.png"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    } finally {
      this.cleanup()
    }
  }
}

// --- Managing the 9-Panel Grid ---
export const formulas = new Array(9)
export const mainFormula = createInfo()
const renderers = new Map()
const exporter = new QbistExporter()

// Generate variations based on the current main formula
export function generateFormulas() {
  formulas[0] = mainFormula
  for (let i = 1; i < 9; i++) {
    formulas[i] = modifyInfo(mainFormula)
  }
}

// Initialize or get a renderer for a canvas
function getRenderer(canvas) {
  let renderer = renderers.get(canvas)
  if (!renderer) {
    renderer = new QbistRenderer(canvas)
    renderers.set(canvas, renderer)
  }
  return renderer
}

// Draw the large main pattern and each preview
export async function updateAll() {
  const mainCanvas = document.getElementById("mainPattern")
  const renderPromises = []

  // Start main canvas rendering
  renderPromises.push(
    getRenderer(mainCanvas).render(mainFormula, { keepAlive: true })
  )

  // Start all preview renderings
  for (let i = 0; i < 9; i++) {
    const canvas = document.getElementById(`preview${i}`)
    renderPromises.push(
      getRenderer(canvas).render(formulas[i], { keepAlive: true })
    )
  }

  // Update URL state
  const url = new URL(window.location.href)
  url.searchParams.set("state", btoa(JSON.stringify(mainFormula)))
  window.history.pushState({}, "", url)

  // Wait for all renders to complete
  try {
    await Promise.all(renderPromises)
  } catch (err) {
    console.error("Error during render:", err)
  }
}

// Export functionality
export async function downloadImage(
  outputWidth,
  outputHeight,
  oversampling = 1
) {
  try {
    await exporter.exportImage(mainFormula, outputWidth, outputHeight)
  } catch (err) {
    console.error("Error during image export:", err)
    alert("Failed to export image. Please try again.")
  }
}

// --- Initialization ---
function checkURLState() {
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual"
  }

  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.has("state")) {
    const state = urlParams.get("state")
    loadStateFromParam(state)
    return true
  }
  return false
}

// Initialize
if (!checkURLState()) {
  generateFormulas()
  updateAll()
}

// Cleanup on page unload
window.addEventListener("unload", () => {
  renderers.forEach((renderer) => renderer.cleanup())
  exporter.cleanup()
})
