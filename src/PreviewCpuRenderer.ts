import type { FormulaInfo } from "./qbist.ts"
import CpuWorker from "./worker.ts?worker"

type WorkerProgressMessage = {
  command: "progress"
  requestId: number
  progress: number
}

type WorkerRenderedMessage = {
  command: "rendered"
  requestId: number
  imageData: ArrayBuffer
  width: number
  height: number
}

type WorkerMessage = WorkerProgressMessage | WorkerRenderedMessage

interface PendingJob {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  resolve: () => void
  reject: (error: Error) => void
}

export class PreviewCpuRenderer {
  private worker: Worker
  private nextRequestId: number
  private pendingJobs: Map<number, PendingJob>
  private disposed: boolean

  constructor() {
    this.worker = new CpuWorker()
    this.nextRequestId = 1
    this.pendingJobs = new Map()
    this.disposed = false

    this.worker.addEventListener("message", this.handleMessage)
    this.worker.addEventListener("error", this.handleError)
  }

  render(canvas: HTMLCanvasElement, info: FormulaInfo): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error("Preview renderer has been disposed"))
    }

    const context = canvas.getContext("2d")
    if (!context) {
      return Promise.reject(new Error("Failed to get 2D context for preview canvas"))
    }

    const requestId = this.nextRequestId++

    return new Promise((resolve, reject) => {
      this.pendingJobs.set(requestId, { canvas, context, resolve, reject })
      try {
        this.worker.postMessage({
          command: "render",
          requestId,
          info,
          width: canvas.width,
          height: canvas.height,
          oversampling: 1,
        })
      } catch (error) {
        this.pendingJobs.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  cleanup() {
    if (this.disposed) return

    this.disposed = true
    this.worker.removeEventListener("message", this.handleMessage)
    this.worker.removeEventListener("error", this.handleError)
    this.worker.terminate()

    this.pendingJobs.forEach(({ reject }) => {
      reject(new Error("Preview renderer disposed"))
    })
    this.pendingJobs.clear()
  }

  private handleMessage = (event: MessageEvent<WorkerMessage>) => {
    const data = event.data
    if (!data) return

    if (data.command === "progress") {
      return
    }

    const job = this.pendingJobs.get(data.requestId)
    if (!job) {
      return
    }

    this.pendingJobs.delete(data.requestId)

    try {
      const pixelBuffer = new Uint8ClampedArray(data.imageData)
      const imageData = new ImageData(pixelBuffer, data.width, data.height)
      const { context } = job

      if (job.canvas.width !== data.width || job.canvas.height !== data.height) {
        job.canvas.width = data.width
        job.canvas.height = data.height
      }

      context.putImageData(imageData, 0, 0)
      job.resolve()
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private handleError = (event: ErrorEvent) => {
    const message = event.message || "Preview worker error"
    this.pendingJobs.forEach(({ reject }) => {
      reject(new Error(message))
    })
    this.pendingJobs.clear()
    this.cleanup()
  }
}
