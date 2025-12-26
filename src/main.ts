import './index.css'
import './reset.css'
import { type FormulaInfo } from './qbist.ts'
import { QbistExporter } from './QbistExporter'
import { QbistRenderer } from './QbistRenderer.ts'
import { PreviewCpuRenderer } from './PreviewCpuRenderer.ts'
import { QbistState } from './QbistState.ts'
import { UIController } from './UIController.ts'

function logDebug(message: string, ...args: unknown[]) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`, ...args)
}

// UI Elements
const loadingOverlay = document.getElementById('loadingOverlay')
if (!(loadingOverlay instanceof HTMLElement)) {
  throw new Error('Missing loading overlay element')
}
const loadingText = document.getElementById('loadingText')
if (!(loadingText instanceof HTMLElement)) {
  throw new Error('Missing loading text element')
}
const overlayElement = loadingOverlay
const loadingTextElement = loadingText
const defaultLoadingText = loadingText.textContent ?? ''
loadingOverlay.style.display = 'none'

let initialLoadPending = true
let initialOverlayTimer: number | null = null
let previewWarmupGeneration = 0

function scheduleInitialLoadingOverlay() {
  if (initialOverlayTimer !== null) return
  initialOverlayTimer = window.setTimeout(() => {
    loadingTextElement.textContent = 'Preparing WebGL renderer'
    overlayElement.style.display = 'flex'
  }, 200)
}

function clearInitialLoadingOverlay() {
  if (initialOverlayTimer !== null) {
    window.clearTimeout(initialOverlayTimer)
    initialOverlayTimer = null
  }
  overlayElement.style.display = 'none'
  loadingTextElement.textContent = defaultLoadingText
}

function renderPreviewCpu(index: number, formula: FormulaInfo) {
  const canvas = document.getElementById(`preview${index}`)
  if (!(canvas instanceof HTMLCanvasElement)) {
    console.warn(`Preview canvas preview${index} not found or invalid`)
    return Promise.resolve()
  }

  logDebug(`renderPreviewCpu:start`, { index })
  return previewRenderer
    .render(canvas, formula)
    .then(() => {
      canvas.dataset.previewMode = 'cpu'
      logDebug(`renderPreviewCpu:done`, { index })
    })
    .catch((err: unknown) => {
      logDebug(`renderPreviewCpu:error`, { index, error: err })
    })
}

type RenderPreviewMode = 'standard' | 'warmup'

interface RenderPreviewOptions {
  mode?: RenderPreviewMode
  delayMs?: number
  generation?: number
}

const DEFAULT_MODE = 'standard' as const
const DEFAULT_DELAY_MS = 0 as const
async function renderPreviewWebGl(
  index: number,
  formula: FormulaInfo,
  options: RenderPreviewOptions = {},
) {
  const {
    mode = DEFAULT_MODE,
    delayMs = DEFAULT_DELAY_MS,
    generation,
  } = options
  const element = document.getElementById(`preview${index}`)
  if (!(element instanceof HTMLCanvasElement)) {
    console.warn(`Preview canvas preview${index} not found or invalid`)
    return
  }

  if (delayMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, delayMs))
  }

  logDebug(`renderPreviewWebGl:start`, { index, mode })

  try {
    await QbistRenderer.ensureWorkerResponsive()
    logDebug(`renderPreviewWebGl:workerResponsive`, { index })
    const canvas = element

    let pendingRelease: (() => void) | null = null
    if (canvas.dataset.previewMode === 'cpu') {
      logDebug(`renderPreviewWebGl:willReleaseCpuPreview`, { index, mode })
      if (mode === 'standard') {
        pendingRelease = () => previewRenderer.releaseCanvas(canvas)
      }
    }

    await getRenderer(canvas).render(formula, {
      keepAlive: false,
      refreshEveryFrame: false,
    })

    if (generation !== undefined && generation !== previewWarmupGeneration) {
      logDebug('renderPreviewWebGl:staleGeneration', {
        index,
        mode,
        generation,
      })
      return
    }

    if (pendingRelease) {
      pendingRelease()
    }

    if (mode === 'warmup') {
      canvas.dataset.previewWarmup = 'complete'
      const releaseAfterWarmup = () => {
        if (
          generation !== undefined &&
          generation !== previewWarmupGeneration
        ) {
          logDebug('renderPreviewWebGl:skipReleaseAfterWarmup', {
            index,
            mode,
            generation,
          })
          return
        }
        if (canvas.dataset.previewMode === 'webgl') {
          return
        }
        previewRenderer.releaseCanvas(canvas)
        canvas.dataset.previewMode = 'webgl'
        logDebug('renderPreviewWebGl:releasedAfterWarmup', { index })
      }

      if (canvas.dataset.previewMode === 'cpu') {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(releaseAfterWarmup)
        })
      } else {
        releaseAfterWarmup()
      }

      logDebug(`renderPreviewWebGl:warmupComplete`, { index })
    } else {
      canvas.dataset.previewMode = 'webgl'
    }
    logDebug(`renderPreviewWebGl:done`, { index, mode })
  } catch (error: unknown) {
    logDebug(`renderPreviewWebGl:fallbackToCpu`, { index, error })
    await renderPreviewCpu(index, formula)
  }
}

function queuePreviewWarmup(
  index: number,
  formula: FormulaInfo,
  generation: number,
) {
  if (generation !== previewWarmupGeneration) {
    logDebug('updateAll:warmupSkipped', { index, generation })
    return
  }

  void renderPreviewWebGl(index, formula, {
    mode: 'warmup',
    delayMs: index * 40,
    generation,
  }).catch((error) => {
    logDebug('updateAll:backgroundPreviewError', { index, error })
  })
}

// --- Managing the 9-Panel Grid ---
const renderers = new Map<HTMLCanvasElement, QbistRenderer>()
const exporter = new QbistExporter()
const previewRenderer = new PreviewCpuRenderer()

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
  const renderPromises = []

  logDebug('updateAll:start')

  const shouldShowInitialOverlay = initialLoadPending
  if (shouldShowInitialOverlay) {
    scheduleInitialLoadingOverlay()
  }

  // Start main canvas rendering - only use keepAlive in webgl2.html
  const mainRenderPromise = getRenderer(mainCanvas).render(state.mainFormula, {
    keepAlive: false,
    refreshEveryFrame: false,
  })
  logDebug('updateAll:mainRenderDispatched')
  renderPromises.push(mainRenderPromise)

  if (shouldShowInitialOverlay) {
    function startPreviewsWithWarmup() {
      previewWarmupGeneration += 1
      const currentGeneration = previewWarmupGeneration
      for (let i = 0; i < 9; i++) {
        void renderPreviewCpu(i, state.formulas[i])
          .then(() => {
            queuePreviewWarmup(i, state.formulas[i], currentGeneration)
          })
          .catch((error) => {
            logDebug('updateAll:cpuPreviewError', { index: i, error })
          })
      }
    }

    mainRenderPromise
      .then(() => {
        logDebug('updateAll:mainRenderResolved')
        // Start previews with CPU for immediate feedback, then WebGL
        startPreviewsWithWarmup()
      })
      .catch((err: unknown) => {
        logDebug('updateAll:mainRenderError', { error: err })
        startPreviewsWithWarmup()
      })
  } else {
    previewWarmupGeneration += 1
    const currentGeneration = previewWarmupGeneration
    for (let i = 0; i < 9; i++) {
      const element = document.getElementById(`preview${i}`)
      if (!(element instanceof HTMLCanvasElement)) {
        logDebug('updateAll:missingPreviewCanvas', { index: i })
        continue
      }

      if (element.dataset.previewMode === 'webgl') {
        renderPromises.push(
          renderPreviewWebGl(i, state.formulas[i], {
            generation: currentGeneration,
          }),
        )
      } else {
        const chain = renderPreviewCpu(i, state.formulas[i]).then(() =>
          renderPreviewWebGl(i, state.formulas[i], {
            generation: currentGeneration,
          }),
        )
        renderPromises.push(chain)
      }
    }
  }

  // Update URL state
  const url = new URL(window.location.href)
  url.searchParams.set('state', btoa(JSON.stringify(state.mainFormula)))
  window.history.pushState({}, '', url)
  logDebug('updateAll:urlUpdated')

  // Wait for all renders to complete
  try {
    await Promise.all(renderPromises)
    logDebug('updateAll:allRendersResolved')
  } catch (err) {
    logDebug('updateAll:renderPromiseError', { error: err })
  } finally {
    if (shouldShowInitialOverlay) {
      clearInitialLoadingOverlay()
      initialLoadPending = false
      logDebug('updateAll:initialOverlayCleared')
    }
    logDebug('updateAll:complete')
  }
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
  previewRenderer.cleanup()
})

// Initialize Application
const state = new QbistState()

// Initialize UI
const ui = new UIController(state, updateAll, downloadImage)

// Initial Render
if (!ui.checkURLState()) {
  updateAll()
}
