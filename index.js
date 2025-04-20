import { createInfo, modifyInfo, optimize } from "/qbist.js"
import { loadStateFromParam } from "/qbistListeners.js"

// Get UI elements
const loadingOverlay = document.getElementById("loadingOverlay")
const loadingBar = document.getElementById("loadingBar")
loadingOverlay.style.display = "none"

// Keep track of which canvases have been transferred
const transferredCanvases = new WeakSet()

// Clean up worker for a canvas
function cleanupWorker(canvas) {
  if (canvas.worker) {
    // Send cleanup message to worker before terminating
    canvas.worker.postMessage({ type: "cleanup" })
    // Remove from transferred set
    transferredCanvases.delete(canvas)
    delete canvas.worker
  }
}

function drawQbist(canvas, info, oversampling = 0) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(new Error("Web Workers are not supported in this browser"))
      return
    }
    const isExport = canvas.id === "exportCanvas"
    const keepAlive = !isExport

    // If we already have a worker for this canvas and it's keepAlive,
    // just send an update message instead of transferring again
    if (canvas.worker && keepAlive) {
      canvas.worker.postMessage({
        type: "update",
        info,
      })
      resolve()
      return
    }

    // Clean up any existing worker before creating a new one
    if (canvas.worker) {
      cleanupWorker(canvas)
    }

    // Create the worker instance
    const worker = new Worker("workerWebGL.js", { type: "module" })

    // Store worker reference on the canvas
    canvas.worker = worker

    try {
      // Create an OffscreenCanvas for WebGL rendering
      const offscreen = canvas.transferControlToOffscreen()

      // Listen for messages from the worker
      worker.addEventListener("message", (e) => {
        if (e.data.command === "rendered") {
          if (!keepAlive) {
            cleanupWorker(canvas)
          }
          loadingOverlay.style.display = "none"
          resolve()
        }
      })

      // Listen for errors in the worker
      worker.addEventListener("error", (err) => {
        cleanupWorker(canvas)
        loadingOverlay.style.display = "none"
        reject(err)
      })

      // Show loading overlay for exports only
      if (isExport) {
        loadingOverlay.style.display = "flex"
        loadingBar.style.width = "100%"
      }

      // Initialize the WebGL worker with the canvas and formula
      worker.postMessage(
        {
          type: "init",
          canvas: offscreen,
          width: canvas.width,
          height: canvas.height,
          info: optimizedInfo,
          keepAlive,
        },
        [offscreen]
      )
    } catch (err) {
      cleanupWorker(canvas)
      reject(err)
    }
  })
}

// --- Managing the 9-Panel Grid ---
export const formulas = new Array(9)
export const mainFormula = createInfo()

// Generate variations based on the current main formula.
export function generateFormulas() {
  formulas[0] = mainFormula
  for (let i = 1; i < 9; i++) {
    formulas[i] = modifyInfo(mainFormula)
  }
}

// Draw the large main pattern and each preview.
export function updateAll() {
  const mainCanvas = document.getElementById("mainPattern")
  const oldMainWorker = mainCanvas.worker
  const activeCanvases = []

  // Start main canvas rendering
  const mainPromise = drawQbist(mainCanvas, mainFormula, 1)
  activeCanvases.push(mainPromise)

  // Start all preview renderings
  for (let i = 0; i < 9; i++) {
    const canvas = document.getElementById(`preview${i}`)
    const previewPromise = drawQbist(canvas, formulas[i], 1)
    activeCanvases.push(previewPromise)
  }

  // Update URL state after starting the renders
  const stateToSave = {
    transformSequence: mainFormula.transformSequence,
    source: mainFormula.source,
    control: mainFormula.control,
    dest: mainFormula.dest,
  }
  const url = new URL(window.location.href)
  url.searchParams.set("state", btoa(JSON.stringify(stateToSave)))
  window.history.pushState({}, "", url)

  // Ensure old worker is cleaned up only after new renders have started
  if (oldMainWorker) {
    oldMainWorker.postMessage({ type: "cleanup" })
  }

  // Return promise that resolves when all renders complete
  return Promise.all(activeCanvases).catch((err) => {
    console.error("Error during render:", err)
  })
}

// On page load, check if a state is provided in the URL.
function checkURLState() {
  // Disable default scroll restoration
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

// --- Initialization ---
// Check if a state is provided in the URL and load it.
if (!checkURLState()) {
  generateFormulas()
  updateAll()
}

export async function downloadImage(outputWidth, outputHeight, oversampling) {
  const exportCanvas = document.createElement("canvas")
  exportCanvas.id = "exportCanvas"
  exportCanvas.width = outputWidth
  exportCanvas.height = outputHeight

  await drawQbist(exportCanvas, mainFormula, oversampling)

  const imageDataURL = exportCanvas.toDataURL("image/png")

  // create a temporary download link and trigger the download
  const link = document.createElement("a")
  link.href = imageDataURL
  link.download = "qbist.png"
  //TODO: add metadata to the image so that it can be regenerated at another resolution
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
