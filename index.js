import { createInfo, modifyInfo } from "/qbist.js"
import { loadStateFromParam } from "/qbistListeners.js"
function drawQbist(canvas, info, oversampling = 0) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('Web Workers are not supported in this browser'));
      return;
    }
    const ctx = canvas.getContext("2d")
    const width = canvas.width
    const height = canvas.height

    // Create the worker instance
    const worker = new Worker("worker.js", { type: "module" })
    // Listen for messages from the worker
    worker.addEventListener("message", (e) => {
      const { command } = e.data
      if (command === "progress") {
        const { progress } = e.data
        loadingOverlay.style.display = "flex"
        loadingBar.style.width = `${progress}%`
      } else if (command === "rendered") {
        const { imageData } = e.data
        const data = new Uint8ClampedArray(imageData)
        const imgData = new ImageData(data, width, height)
        ctx.putImageData(imgData, 0, 0)
        worker.terminate() // Clean up the worker
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

    // Prepare and send the payload to the worker
    const payload = {
      command: "render",
      info,
      width,
      height,
      oversampling,
    }
    worker.postMessage(payload)
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
    const canvas = document.getElementById("preview" + i)
    drawQbist(canvas, formulas[i], 1)
  }
  const url = new URL(window.location.href)
  url.searchParams.set("state", btoa(JSON.stringify(mainFormula)))
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

const loadingOverlay = document.getElementById("loadingOverlay")
const loadingBar = document.getElementById("loadingBar")
loadingOverlay.style.display = "none"
