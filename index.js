import { createInfo, modifyInfo } from "./qbist.js"
import { loadStateFromParam } from "./qbistListeners.js"
import { QbistExporter } from "./QbistExporter.js"
import { QbistRenderer } from "./QbistRenderer.js"

// UI Elements
const loadingOverlay = document.getElementById("loadingOverlay")
const loadingBar = document.getElementById("loadingBar")
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

  // Start main canvas rendering - keep alive and refresh every frame for animation
  renderPromises.push(
    getRenderer(mainCanvas).render(mainFormula, {
      keepAlive: true,
      refreshEveryFrame: false,
    })
  )

  // Start all preview renderings - no keepAlive or refreshEveryFrame needed
  for (let i = 0; i < 9; i++) {
    const canvas = document.getElementById(`preview${i}`)
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
