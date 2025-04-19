import { createInfo, modifyInfo, optimize } from "/qbist.js"
import { loadStateFromParam } from "/qbistListeners.js"

// Get UI elements
const loadingOverlay = document.getElementById("loadingOverlay")
const loadingBar = document.getElementById("loadingBar")
loadingOverlay.style.display = "none"

// Keep track of which canvases have been transferred
const transferredCanvases = new WeakSet()

function drawQbist(canvas, info, oversampling = 0) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(new Error("Web Workers are not supported in this browser"))
      return
    }

    // Run optimize function
    const { usedTransFlag, usedRegFlag } = optimize(info)
    const optimizedInfo = {
      ...info,
      usedTransFlag,
      usedRegFlag,
    }

    // Check if canvas was already transferred
    if (transferredCanvases.has(canvas)) {
      // For already transferred canvases, just send the new info to update
      const worker = canvas.worker
      worker.postMessage({
        type: "update",
        info: optimizedInfo,
      })
      resolve()
      return
    }

    // Create the worker instance
    const worker = new Worker("workerWebGL.js", { type: "module" })

    // Store worker reference on the canvas
    canvas.worker = worker

    // Create an OffscreenCanvas for WebGL rendering
    const offscreen = canvas.transferControlToOffscreen()

    // Mark this canvas as transferred
    transferredCanvases.add(canvas)

    // Listen for messages from the worker
    worker.addEventListener("message", (e) => {
      if (e.data.command === "rendered") {
        if (!e.data.keepAlive) {
          worker.terminate() // Clean up the worker
        }
        loadingOverlay.style.display = "none"
        resolve() // Resolve the Promise when rendering is complete
      }
    })

    // Listen for errors in the worker
    worker.addEventListener("error", (err) => {
      worker.terminate() // Clean up the worker on error
      loadingOverlay.style.display = "none"
      reject(err)
    })

    // Show loading overlay for main canvas only
    if (canvas.id === "mainPattern") {
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
        keepAlive: true, // Keep the worker alive for future updates
      },
      [offscreen]
    )
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
  drawQbist(mainCanvas, mainFormula, 1)
  for (let i = 0; i < 9; i++) {
    const canvas = document.getElementById(`preview${i}`)
    drawQbist(canvas, formulas[i], 1)
  }
  const stateToSave = {
    transformSequence: mainFormula.transformSequence,
    source: mainFormula.source,
    control: mainFormula.control,
    dest: mainFormula.dest,
  }
  const url = new URL(window.location.href)
  url.searchParams.set("state", btoa(JSON.stringify(stateToSave)))
  window.history.pushState({}, "", url)
}

// On page load, check if a state is provided in the URL.
function checkURLState() {
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
