export class QbistRenderer {
  constructor(canvas) {
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

    this.worker = new Worker("workerWebGL.js", { type: "module" })
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

  async render(info, options = {}) {
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

      const onMessage = (e) => {
        if (e.data.command === "rendered") {
          if (!this.keepAlive) {
            this.worker.removeEventListener("message", onMessage)
          }
          if (isExport) {
            loadingOverlay.style.display = "none"
          }
          resolve(e.data)
        } else if (e.data.command === "error") {
          this.worker.removeEventListener("message", onMessage)
          reject(new Error(e.data.message))
          loadingOverlay.style.display = "none"
        }
      }

      this.worker.addEventListener("message", onMessage)

      try {
        if (isExport) {
          loadingOverlay.style.display = "flex"
          loadingBar.style.width = "100%"
        }

        if (!this.isInitialized) {
          // Initial setup - transfer the canvas
          const offscreen = this.canvas.transferControlToOffscreen()
          this.worker.postMessage(
            {
              type: "init",
              canvas: offscreen,
              info,
              keepAlive: this.keepAlive,
              refreshEveryFrame,
            },
            [offscreen]
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

  update(info) {
    if (this.worker) {
      this.worker.postMessage({
        type: "update",
        info,
        keepAlive: this.keepAlive,
      })
    }
  }
}
