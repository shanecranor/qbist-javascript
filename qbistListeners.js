import {
  mainFormula,
  generateFormulas,
  updateAll,
  formulas,
  downloadImage,
} from "./index.js"
import { createInfo } from "./qbist.js"
// Prompt the user for a state code or URL and load it.
export function loadStateFromUserInput() {
  const input = prompt("Paste your shared pattern URL or state code:")
  if (!input) return
  let stateBase64
  try {
    const url = new URL(input)
    stateBase64 = url.searchParams.get("state")
  } catch (e) {
    stateBase64 = input
  }
  if (stateBase64) {
    loadStateFromParam(stateBase64)
  } else {
    alert("Invalid input")
  }
}
// save the current formula state to url parameter
function saveState() {
  const stateJSON = JSON.stringify(mainFormula)
  const stateBase64 = btoa(stateJSON)
  const url = new URL(window.location.href)
  url.searchParams.set("state", stateBase64)
  const shareURL = url.toString()
  prompt("Copy this URL to share your pattern:", shareURL)
}

// load state from a base64 string.
export function loadStateFromParam(stateBase64) {
  try {
    const stateJSON = atob(stateBase64)
    const stateObj = JSON.parse(stateJSON)
    if (
      stateObj.transformSequence &&
      stateObj.source &&
      stateObj.control &&
      stateObj.dest
    ) {
      Object.assign(mainFormula, stateObj)
      generateFormulas()
      updateAll()
    } else {
      alert("Invalid pattern state")
    }
  } catch (e) {
    console.error("Error loading state:", e)
    alert("Error loading pattern state")
  }
}
// when a preview is clicked, use its formula as the new main pattern
document.querySelectorAll(".preview").forEach((canvas) => {
  canvas.addEventListener("click", () => {
    const index = parseInt(canvas.id.replace("preview", ""))
    Object.assign(mainFormula, formulas[index])
    generateFormulas()
    updateAll()
  })
})

// button event listeners
document.getElementById("regenButton").addEventListener("click", () => {
  // ... other imports or code ...

  // Somewhere in the file (e.g., line 69)
  Object.assign(mainFormula, createInfo())
  generateFormulas()
  updateAll()
})
document
  .getElementById("savePatternButton")
  .addEventListener("click", saveState)

function downloadListener() {
  const outputWidth = parseInt(document.getElementById("outputWidth").value)
  const outputHeight = parseInt(document.getElementById("outputHeight").value)
  const oversampling = parseInt(document.getElementById("oversampling").value)
  downloadImage(outputWidth, outputHeight, oversampling)
}

document
  .getElementById("downloadButton")
  .addEventListener("click", downloadListener)
