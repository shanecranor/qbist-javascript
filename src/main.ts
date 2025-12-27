import './index.css'
import './reset.css'
import { QbistExporter } from './QbistExporter'
import { QbistRenderer } from './QbistRenderer.ts'
import { QbistState } from './QbistState.ts'
import { UIController } from './UIController.ts'
import { PreviewManager } from './PreviewManager.ts'

function logDebug(message: string, ...args: unknown[]) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`, ...args)
}

let initialLoadPending = true

// --- Components ---
const state = new QbistState()
const renderers = new Map<HTMLCanvasElement, QbistRenderer>()
const exporter = new QbistExporter()
const previewManager = new PreviewManager()
// eslint-disable-next-line import/no-mutable-exports
let ui: UIController

// Initialize or get a renderer for a canvas
function getRenderer(canvas: HTMLCanvasElement) {
  let renderer = renderers.get(canvas)
  if (!renderer) {
    renderer = new QbistRenderer(canvas)
    renderers.set(canvas, renderer)
    logDebug('getRenderer:created', { canvasId: canvas.id })
  }
  return renderer
}

// Draw the large main pattern and each preview
async function updateAll() {
  const mainCanvas = document.getElementById('mainPattern')
  if (!(mainCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Main canvas element not found or invalid')
  }

  logDebug('updateAll:start')

  if (initialLoadPending) {
    ui?.scheduleInitialLoadingOverlay()
  }

  // 1. Render Main View
  try {
    const mainRenderer = getRenderer(mainCanvas)
    await mainRenderer.render(state.mainFormula, {
      keepAlive: false,
      refreshEveryFrame: false,
    })
    logDebug('updateAll:mainRenderResolved')
  } catch (err) {
    logDebug('updateAll:mainRenderError', { error: err })
  }

  // 2. Render Previews
  // When initial load is pending, we use the "warmup" strategy
  await previewManager.updatePreviews(state.formulas, initialLoadPending)

  // 3. Update URL
  const url = new URL(window.location.href)
  url.searchParams.set('state', btoa(JSON.stringify(state.mainFormula)))
  window.history.pushState({}, '', url)
  logDebug('updateAll:urlUpdated')

  // 4. Cleanup Overlay
  if (initialLoadPending) {
    ui?.clearInitialLoadingOverlay()
    initialLoadPending = false
    logDebug('updateAll:initialOverlayCleared')
  }
  logDebug('updateAll:complete')
}

// Export functionality
async function downloadImage(
  outputWidth: number,
  outputHeight: number,
  _oversampling = 1,
) {
  try {
    await exporter.exportImage(state.mainFormula, outputWidth, outputHeight)
    logDebug('downloadImage:complete', { outputWidth, outputHeight })
  } catch (err) {
    logDebug('downloadImage:error', { error: err })
    alert('Failed to export image. Please try again.')
  }
}

// Cleanup on page unload
window.addEventListener('unload', () => {
  renderers.forEach((renderer) => renderer.cleanup())
  exporter.cleanup()
  previewManager.cleanup()
})

// Initialize UI
ui = new UIController(state, updateAll, downloadImage)

// Initial Render
if (!ui.checkURLState()) {
  updateAll()
}
