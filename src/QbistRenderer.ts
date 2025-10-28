import type { FormulaInfo } from "./qbist"
import WebGlWorker from "./workerWebGL.ts?worker"
interface RenderOptions {
  keepAlive?: boolean
  refreshEveryFrame?: boolean
  isExport?: boolean
}
export class QbistRenderer {
  canvas: HTMLCanvasElement
  worker: Worker | null
  isInitialized: boolean
  keepAlive: boolean
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.worker = null
    this.isInitialized = false
    this.keepAlive = false
    console.log(`[Canvas Create] Created renderer for canvas ${canvas.id}`)
    this._setupWorker()
  }

  _setupWorker() {
    if (typeof Worker === "undefined") {
      throw new Error("Web Workers are not supported in this browser")
    }
    // Cleanup existing worker if any
    this.cleanup()
    this.worker = new WebGlWorker()
    this.worker.onerror = (err) => {
      console.error("Worker error:", err)
      this.cleanup()
    }
  }

  cleanup() {
    if (this.worker) {
      this.worker.postMessage({ type: "cleanup" })
      this.worker = null
    }
    this.isInitialized = false
    this.keepAlive = false
    console.log(
      `[Canvas Delete] Cleaned up renderer for canvas ${this.canvas.id}`
    )
  }

  async render(info: FormulaInfo, options: RenderOptions = {}) {
    const {
      keepAlive = false,
      refreshEveryFrame = false,
      isExport = false,
    } = options
    this.keepAlive = keepAlive

    return new Promise((resolve, reject) => {
      const loadingOverlay = document.getElementById("loadingOverlay")
      const loadingBar = document.getElementById("loadingBar")
      if (!this.worker) {
        this._setupWorker()
      }
      if (!this.worker) throw new Error("Worker is not initialized")
      const onMessage = (e: MessageEvent) => {
        if (!this.worker) throw new Error("Worker is not initialized")
        if (e.data.command === "rendered") {
          if (!this.keepAlive) {
            this.worker.removeEventListener("message", onMessage)
          }
          if (isExport && loadingOverlay) loadingOverlay.style.display = "none"
          resolve(e.data)
        } else if (e.data.command === "error") {
          this.worker.removeEventListener("message", onMessage)
          reject(new Error(e.data.message))
          if (loadingOverlay) loadingOverlay.style.display = "none"
        }
      }

      this.worker.addEventListener("message", onMessage)

      try {
        if (isExport && loadingOverlay && loadingBar) {
          loadingOverlay.style.display = "flex"
          loadingBar.style.width = "100%"
        }

        if (!this.isInitialized) {
          let initCanvas: HTMLCanvasElement | OffscreenCanvas = this.canvas
          let transferList: Transferable[] = []
          try {
            const offscreen: OffscreenCanvas =
              this.canvas.transferControlToOffscreen()
            initCanvas = offscreen
            transferList = [offscreen]
          } catch (err) {
            console.warn(
              "OffscreenCanvas not supported, falling back to regular canvas",
              err
            )
          }

          this.worker.postMessage(
            {
              type: "init",
              canvas: initCanvas,
              info,
              keepAlive: this.keepAlive,
              refreshEveryFrame,
            },
            transferList
          )
          this.isInitialized = true
        } else {
          // Just update the info for subsequent renders
          this.worker.postMessage({
            type: "update",
            info,
            keepAlive: this.keepAlive,
            refreshEveryFrame,
          })
        }
      } catch (err) {
        this.worker.removeEventListener("message", onMessage)
        reject(err)
      }
    })
  }

  update(info: FormulaInfo) {
    if (this.worker) {
      this.worker.postMessage({
        type: "update",
        info,
        keepAlive: this.keepAlive,
      })
    }
  }
}
