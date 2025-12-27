import type { FormulaInfo } from './qbist.ts'
import CpuWorker from './worker.ts?worker'

type RenderCommand = {
  command: 'render'
  requestId: number
  info: FormulaInfo
  width: number
  height: number
  oversampling: number
}

type WorkerMessage =
  | {
      command: 'rendered'
      requestId: number
      imageData: ArrayBuffer
      width: number
      height: number
    }
  | {
      command: 'progress'
      requestId: number
      progress: number
    }

type PendingJob = {
  canvas: HTMLCanvasElement
  resolve: () => void
  reject: (error: Error) => void
}

export interface CpuRenderOptions {
  oversampling?: number
}

export class MainCpuRenderer {
  private worker: Worker
  private nextRequestId = 1
  private pendingJobs = new Map<number, PendingJob>()
  private disposed = false

  constructor() {
    this.worker = new CpuWorker()
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
  }

  render(
    canvas: HTMLCanvasElement,
    info: FormulaInfo,
    options: CpuRenderOptions = {},
  ): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('CPU renderer disposed'))
    }

    const oversampling = Number.isFinite(options.oversampling)
      ? Math.max(1, Math.floor(options.oversampling as number))
      : 1

    const requestId = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pendingJobs.set(requestId, { canvas, resolve, reject })
      try {
        const message: RenderCommand = {
          command: 'render',
          requestId,
          info,
          width: canvas.width,
          height: canvas.height,
          oversampling,
        }
        this.worker.postMessage(message)
      } catch (error) {
        this.pendingJobs.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  cleanup() {
    if (this.disposed) return
    this.disposed = true

    this.pendingJobs.forEach(({ reject }) => {
      reject(new Error('CPU renderer disposed'))
    })
    this.pendingJobs.clear()

    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    this.worker.terminate()
  }

  private handleMessage = (event: MessageEvent<WorkerMessage>) => {
    const data = event.data
    if (!data) return

    if (data.command === 'progress') {
      return
    }

    const job = this.pendingJobs.get(data.requestId)
    if (!job) {
      return
    }

    this.pendingJobs.delete(data.requestId)

    try {
      const context = job.canvas.getContext('2d')
      if (!context) {
        throw new Error('Failed to get canvas context for CPU render')
      }

      const pixels = new Uint8ClampedArray(data.imageData)
      const imageData = new ImageData(pixels, data.width, data.height)
      context.putImageData(imageData, 0, 0)
      job.resolve()
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private handleError = (event: ErrorEvent) => {
    if (this.disposed) return
    const message = event.message || 'CPU worker error'
    this.pendingJobs.forEach(({ reject }) => {
      reject(new Error(message))
    })
    this.pendingJobs.clear()
    this.cleanup()
  }
}
