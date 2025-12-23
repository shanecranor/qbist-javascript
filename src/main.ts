import "./index.css"
import "./reset.css"
import { createInfo, modifyInfo } from "./qbist.ts"
import { loadStateFromParam } from "./qbistListeners.ts"
import { QbistExporter } from "./QbistExporter"
import { QbistRenderer } from "./QbistRenderer.ts"

// UI Elements
const loadingOverlay = document.getElementById("loadingOverlay")
if (!(loadingOverlay instanceof HTMLElement)) {
  throw new Error("Missing loading overlay element")
}
loadingOverlay.style.display = "none"

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
function getRenderer(canvas: HTMLCanvasElement) {
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
  if (!(mainCanvas instanceof HTMLCanvasElement) || !mainCanvas) {
    throw new Error("Main canvas element not found or invalid")
  }
  const renderPromises = []

  // Start main canvas rendering - only use keepAlive in webgl2.html
  renderPromises.push(
    getRenderer(mainCanvas).render(mainFormula, {
      keepAlive: false,
      refreshEveryFrame: false,
    })
  )

  // Start all preview renderings
  for (let i = 0; i < 9; i++) {
    const canvas = document.getElementById(`preview${i}`)
    if (!(canvas instanceof HTMLCanvasElement) || !canvas) {
      console.warn(`Preview canvas preview${i} not found or invalid`)
      continue
    }
    renderPromises.push(
      getRenderer(canvas).render(formulas[i], {
        keepAlive: false,
        refreshEveryFrame: false,
      })
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
  outputWidth: number,
  outputHeight: number,
  _oversampling = 1
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
