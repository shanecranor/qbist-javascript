import {
  mainFormula,
  generateFormulas,
  updateAll,
  formulas,
  downloadImage,
} from "./main.ts"
import {
  createInfo,
  exportToGimpFormat,
  importFromGimpFormat,
  type FormulaInfo,
} from "./qbist.ts"

const EXPECTED_GIMP_BUFFER_SIZE = 288

function isFormulaInfo(value: unknown): value is FormulaInfo {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Partial<FormulaInfo>
  const keys: Array<keyof FormulaInfo> = [
    "transformSequence",
    "source",
    "control",
    "dest",
  ]
  return keys.every((key) => {
    const array = candidate[key]
    return Array.isArray(array) && array.every((item) => typeof item === "number")
  })
}

export function loadStateFromUserInput(): void {
  const input = prompt("Paste your shared pattern URL or state code:")
  if (!input) return
  let stateBase64: string | null
  try {
    const url = new URL(input)
    stateBase64 = url.searchParams.get("state")
  } catch (error) {
    stateBase64 = input
  }
  if (stateBase64) {
    loadStateFromParam(stateBase64)
  } else {
    alert("Invalid input")
  }
}

function saveState(): void {
  const stateJSON = JSON.stringify(mainFormula)
  const stateBase64 = btoa(stateJSON)
  const url = new URL(window.location.href)
  url.searchParams.set("state", stateBase64)
  const shareURL = url.toString()
  prompt("Copy this URL to share your pattern:", shareURL)
}

export function loadStateFromParam(stateBase64: string | null): void {
  if (!stateBase64) {
    alert("Invalid pattern state")
    return
  }
  try {
    const stateJSON = atob(stateBase64)
    const stateObj: unknown = JSON.parse(stateJSON)
    if (isFormulaInfo(stateObj)) {
      Object.assign(mainFormula, stateObj)
      generateFormulas()
      updateAll()
    } else {
      alert("Invalid pattern state")
    }
  } catch (error) {
    console.error("Error loading state:", error)
    alert("Error loading pattern state")
  }
}

window.addEventListener("popstate", () => {
  const url = new URL(window.location.href)
  const state = url.searchParams.get("state")
  if (state) {
    loadStateFromParam(state)
  }
})

function exportToGimp(): void {
  const buffer = exportToGimpFormat(mainFormula)
  const blob = new Blob([buffer], { type: "application/octet-stream" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  try {
    link.href = url
    link.download = "pattern.qbe"
    document.body.appendChild(link)
    link.click()
  } finally {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}

function importFromGimp(): void {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".qbe"
  input.onchange = async (event) => {
    const target = event.target as HTMLInputElement | null
    const file = target?.files?.[0]
    if (!file) return

    const buffer = await file.arrayBuffer()
    if (buffer.byteLength !== EXPECTED_GIMP_BUFFER_SIZE) {
      alert("Invalid GIMP Qbist file format")
      return
    }

    try {
      const importedFormula = importFromGimpFormat(buffer)
      Object.assign(mainFormula, importedFormula)
      generateFormulas()
      updateAll()
    } catch (error) {
      console.error("Error importing file:", error)
      alert("Error importing file")
    }
  }
  input.click()
}

const grid = document.getElementById("grid")
if (!(grid instanceof HTMLElement)) {
  throw new Error("Grid element not found or invalid")
}

grid.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null
  const canvas = target?.closest(".preview")
  if (!(canvas instanceof HTMLCanvasElement)) return

  const index = Number.parseInt(canvas.id.replace("preview", ""), 10)
  if (Number.isNaN(index) || !formulas[index]) return

  Object.assign(mainFormula, formulas[index])
  generateFormulas()
  updateAll()
})

const regenButton = document.getElementById("regenButton")
if (!(regenButton instanceof HTMLElement)) {
  throw new Error("Regen button element not found")
}

regenButton.addEventListener("click", () => {
  Object.assign(mainFormula, createInfo())
  generateFormulas()
  updateAll()
})

const savePatternButton = document.getElementById("savePatternButton")
if (!(savePatternButton instanceof HTMLElement)) {
  throw new Error("Save pattern button element not found")
}

savePatternButton.addEventListener("click", saveState)

function downloadListener(): void {
  const outputWidthInput = document.getElementById(
    "outputWidth"
  ) as HTMLInputElement | null
  const outputHeightInput = document.getElementById(
    "outputHeight"
  ) as HTMLInputElement | null
  const oversamplingInput = document.getElementById(
    "oversampling"
  ) as HTMLInputElement | null

  if (!outputWidthInput || !outputHeightInput || !oversamplingInput) {
    alert("Missing download settings inputs")
    return
  }

  const outputWidth = Number.parseInt(outputWidthInput.value, 10)
  const outputHeight = Number.parseInt(outputHeightInput.value, 10)
  const oversampling = Number.parseInt(oversamplingInput.value, 10)

  if (
    Number.isNaN(outputWidth) ||
    Number.isNaN(outputHeight) ||
    Number.isNaN(oversampling)
  ) {
    alert("Invalid download settings values")
    return
  }

  downloadImage(outputWidth, outputHeight, oversampling)
}

const downloadButton = document.getElementById("downloadButton")
if (!(downloadButton instanceof HTMLElement)) {
  throw new Error("Download button element not found")
}

downloadButton.addEventListener("click", downloadListener)

const exportGimpButton = document.getElementById("exportGimpButton")
if (!(exportGimpButton instanceof HTMLElement)) {
  throw new Error("Export GIMP button element not found")
}

exportGimpButton.addEventListener("click", (event) => {
  event.preventDefault()
  exportToGimp()
  const settingsDialog = document.getElementById("settingsDialog")
  if (settingsDialog instanceof HTMLDialogElement) {
    settingsDialog.close()
  }
})

const nav = document.querySelector("nav .links")
if (!(nav instanceof HTMLElement)) {
  throw new Error("Navigation links container not found")
}

const importButton = document.createElement("a")
importButton.textContent = "Import GIMP Pattern"
importButton.style.cursor = "pointer"
importButton.addEventListener("click", importFromGimp)
nav.insertBefore(importButton, nav.firstChild)
