import {
  exportToGimpFormat,
  importFromGimpFormat,
  isFormulaInfo,
  createInfo,
} from './qbist.ts'
import { type QbistState } from './QbistState.ts'

const EXPECTED_GIMP_BUFFER_SIZE = 288

export class UIController {
  private state: QbistState
  private onUpdate: () => void
  private onDownload: (
    width: number,
    height: number,
    oversampling: number,
  ) => void

  constructor(
    state: QbistState,
    onUpdate: () => void,
    onDownload: (width: number, height: number, oversampling: number) => void,
  ) {
    this.state = state
    this.onUpdate = onUpdate
    this.onDownload = onDownload

    this.initialize()
  }

  private initialize() {
    this.setupUrlHandling()
    this.setupOverlay()
    this.setupRenderModeToggle()
    this.setupGridListeners()
    this.setupActionListeners()
    this.setupNavLinks()
  }

  // --- URL State Handling ---

  private setupUrlHandling() {
    window.addEventListener('popstate', () => {
      const url = new URL(window.location.href)
      const state = url.searchParams.get('state')
      if (state) {
        this.loadStateFromParam(state)
      }
    })

    // Initial check
    this.checkURLState()
  }

  checkURLState(): boolean {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }

    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('state')) {
      const state = urlParams.get('state')
      this.loadStateFromParam(state)
      return true
    }
    return false
  }

  private loadStateFromParam(stateBase64: string | null): void {
    if (!stateBase64) {
      alert('Invalid pattern state')
      return
    }
    try {
      const stateJSON = atob(stateBase64)
      const stateObj: unknown = JSON.parse(stateJSON)
      if (isFormulaInfo(stateObj)) {
        Object.assign(this.state.mainFormula, stateObj)
        this.state.generateFormulas()
        this.onUpdate()
      } else {
        alert('Invalid pattern state')
      }
    } catch (error) {
      console.error('Error loading state:', error)
      alert('Error loading pattern state')
    }
  }

  // --- Event Listeners ---

  private setupGridListeners() {
    const grid = document.getElementById('grid')
    if (grid instanceof HTMLElement) {
      grid.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null
        const canvas = target?.closest('.preview')
        if (!(canvas instanceof HTMLCanvasElement)) return

        const index = Number.parseInt(canvas.id.replace('preview', ''), 10)
        if (Number.isNaN(index) || !this.state.formulas[index]) return

        Object.assign(this.state.mainFormula, this.state.formulas[index])
        this.state.generateFormulas()
        this.onUpdate()
      })
    }
  }

  private setupActionListeners() {
    // Regenerate
    const regenButton = document.getElementById('regenButton')
    if (regenButton instanceof HTMLElement) {
      regenButton.addEventListener('click', () => {
        Object.assign(this.state.mainFormula, createInfo())
        this.state.generateFormulas()
        this.onUpdate()
      })
    }

    // Save/Share
    const savePatternButton = document.getElementById('savePatternButton')
    if (savePatternButton instanceof HTMLElement) {
      savePatternButton.addEventListener('click', () => this.saveState())
    }

    // Animate
    const animateButton = document.getElementById('animateButton')
    if (animateButton instanceof HTMLElement) {
      animateButton.addEventListener('click', () => this.animate())
    }

    // Download
    const downloadButton = document.getElementById('downloadButton')
    if (downloadButton instanceof HTMLElement) {
      downloadButton.addEventListener('click', () => this.handleDownload())
    }

    // Export GIMP
    const exportGimpButton = document.getElementById('exportGimpButton')
    if (exportGimpButton instanceof HTMLElement) {
      exportGimpButton.addEventListener('click', (event) => {
        event.preventDefault()
        this.exportToGimp()
        const settingsDialog = document.getElementById('settingsDialog')
        if (settingsDialog instanceof HTMLDialogElement) {
          settingsDialog.close()
        }
      })
    }
  }

  private setupRenderModeToggle() {
    const toggle = document.getElementById('renderModeToggle')
    if (!(toggle instanceof HTMLInputElement)) {
      return
    }

    toggle.checked = this.state.useGpu
    this.updateRenderModeLabel(toggle.checked)

    toggle.addEventListener('change', () => {
      this.state.useGpu = toggle.checked
      this.updateRenderModeLabel(toggle.checked)
      this.onUpdate()
    })
  }

  syncRenderModeToggle() {
    const toggle = document.getElementById('renderModeToggle')
    if (!(toggle instanceof HTMLInputElement)) {
      return
    }
    toggle.checked = this.state.useGpu
    this.updateRenderModeLabel(toggle.checked)
  }

  private updateRenderModeLabel(useGpu: boolean) {
    const label = document.querySelector('.render-mode-toggle span')
    if (label instanceof HTMLElement) {
      label.textContent = useGpu ? 'GPU Rendering' : 'CPU Rendering'
    }
  }

  private setupNavLinks() {
    const nav = document.querySelector('nav .links')
    if (nav instanceof HTMLElement) {
      const importButton = document.createElement('a')
      importButton.textContent = 'Import GIMP Pattern'
      importButton.style.cursor = 'pointer'
      importButton.addEventListener('click', () => this.importFromGimp())
      nav.insertBefore(importButton, nav.firstChild)
    }
  }

  // --- Actions ---

  private saveState(): void {
    const stateJSON = JSON.stringify(this.state.mainFormula)
    const stateBase64 = btoa(stateJSON)
    const url = new URL(window.location.href)
    url.searchParams.set('state', stateBase64)
    const shareURL = url.toString()
    prompt('Copy this URL to share your pattern:', shareURL)
  }

  private animate(): void {
    const stateJSON = JSON.stringify(this.state.mainFormula)
    const stateBase64 = btoa(stateJSON)
    const url = new URL('webgl2.html', window.location.href)
    url.searchParams.set('state', stateBase64)
    window.open(url.toString(), '_blank')
  }

  private handleDownload(): void {
    const outputWidthInput = document.getElementById(
      'outputWidth',
    ) as HTMLInputElement | null
    const outputHeightInput = document.getElementById(
      'outputHeight',
    ) as HTMLInputElement | null
    const oversamplingInput = document.getElementById(
      'oversampling',
    ) as HTMLInputElement | null

    if (!outputWidthInput || !outputHeightInput || !oversamplingInput) {
      alert('Missing download settings inputs')
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
      alert('Invalid download settings values')
      return
    }

    this.onDownload(outputWidth, outputHeight, oversampling)
  }

  private exportToGimp(): void {
    const buffer = exportToGimpFormat(this.state.mainFormula)
    const blob = new Blob([buffer], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    try {
      link.href = url
      link.download = 'pattern.qbe'
      document.body.appendChild(link)
      link.click()
    } finally {
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  private importFromGimp(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.qbe'
    input.onchange = async (event) => {
      const target = event.target as HTMLInputElement | null
      const file = target?.files?.[0]
      if (!file) return

      const buffer = await file.arrayBuffer()
      if (buffer.byteLength !== EXPECTED_GIMP_BUFFER_SIZE) {
        alert('Invalid GIMP Qbist file format')
        return
      }

      try {
        const importedFormula = importFromGimpFormat(buffer)
        Object.assign(this.state.mainFormula, importedFormula)
        this.state.generateFormulas()
        this.onUpdate()
      } catch (error) {
        console.error('Error importing file:', error)
        alert('Error importing file')
      }
    }
    input.click()
  }

  // --- Overlay Management ---

  private loadingOverlay: HTMLElement | null = null
  private loadingText: HTMLElement | null = null
  private defaultLoadingText = ''
  private initialOverlayTimer: number | null = null

  private setupOverlay() {
    this.loadingOverlay = document.getElementById('loadingOverlay')
    this.loadingText = document.getElementById('loadingText')
    if (this.loadingOverlay && this.loadingText) {
      this.defaultLoadingText = this.loadingText.textContent ?? ''
      this.loadingOverlay.style.display = 'none'
    }
  }

  scheduleInitialLoadingOverlay() {
    if (
      this.initialOverlayTimer !== null ||
      !this.loadingOverlay ||
      !this.loadingText
    )
      return
    this.initialOverlayTimer = window.setTimeout(() => {
      if (this.loadingText && this.loadingOverlay) {
        this.loadingText.textContent = 'Preparing WebGL renderer'
        this.loadingOverlay.style.display = 'flex'
      }
    }, 200)
  }

  clearInitialLoadingOverlay() {
    if (this.initialOverlayTimer !== null) {
      window.clearTimeout(this.initialOverlayTimer)
      this.initialOverlayTimer = null
    }
    if (this.loadingOverlay && this.loadingText) {
      this.loadingOverlay.style.display = 'none'
      this.loadingText.textContent = this.defaultLoadingText
    }
  }
}
