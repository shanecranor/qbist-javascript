import type { FormulaInfo } from './qbist.ts'
import CpuWorker from './worker.ts?worker'

type WorkerProgressMessage = {
  command: 'progress'
  requestId: number
  progress: number
}

type WorkerRenderedMessage = {
  command: 'rendered'
  requestId: number
  imageData: ArrayBuffer
  width: number
  height: number
}

type WorkerMessage = WorkerProgressMessage | WorkerRenderedMessage

interface PendingJob {
  canvas: HTMLCanvasElement
  resolve: () => void
  reject: (error: Error) => void
}

export class PreviewCpuRenderer {
  private worker: Worker
  private nextRequestId = 1
  private pendingJobs = new Map<number, PendingJob>()
  private disposed = false
  private objectUrlByCanvas = new Map<HTMLCanvasElement, string>()
  private debug = false

  constructor() {
    this.worker = new CpuWorker()
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
    this.logDebug('constructor:init')
  }

  render(canvas: HTMLCanvasElement, info: FormulaInfo): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('Preview renderer has been disposed'))
    }

    const requestId = this.nextRequestId++
    this.logDebug('render:dispatch', {
      canvasId: canvas.id,
      width: canvas.width,
      height: canvas.height,
      requestId,
    })

    return new Promise((resolve, reject) => {
      this.pendingJobs.set(requestId, { canvas, resolve, reject })
      try {
        this.worker.postMessage({
          command: 'render',
          requestId,
          info,
          width: canvas.width,
          height: canvas.height,
          oversampling: 1,
        })
      } catch (error) {
        this.pendingJobs.delete(requestId)
        this.logDebug('render:postMessageError', {
          canvasId: canvas.id,
          requestId,
          error,
        })
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  cleanup() {
    if (this.disposed) return

    this.logDebug('cleanup:start')
    this.disposed = true

    const trackedCanvases = Array.from(this.objectUrlByCanvas.keys())
    trackedCanvases.forEach((canvas) => this.releaseCanvas(canvas))
    this.objectUrlByCanvas.clear()

    this.pendingJobs.forEach(({ reject }) => {
      reject(new Error('Preview renderer disposed'))
    })
    this.pendingJobs.clear()

    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    this.worker.terminate()

    this.logDebug('cleanup:complete')
  }

  releaseCanvas(canvas: HTMLCanvasElement) {
    this.logDebug('releaseCanvas:start', { canvasId: canvas.id })

    const url = this.objectUrlByCanvas.get(canvas)
    if (url) {
      URL.revokeObjectURL(url)
      this.objectUrlByCanvas.delete(canvas)
      this.logDebug('releaseCanvas:revokedUrl', { canvasId: canvas.id })
    }

    canvas.style.backgroundImage = ''
    canvas.style.backgroundSize = ''
    canvas.style.backgroundRepeat = ''
    canvas.style.backgroundPosition = ''
    delete canvas.dataset.previewImageUrl
    delete canvas.dataset.previewMode

    this.logDebug('releaseCanvas:clearedStyles', { canvasId: canvas.id })
  }

  private handleMessage = (event: MessageEvent<WorkerMessage>) => {
    const data = event.data
    if (!data) return

    if (data.command === 'progress') {
      this.logDebug('message:progress', {
        requestId: data.requestId,
        progress: data.progress,
      })
      return
    }

    const job = this.pendingJobs.get(data.requestId)
    if (!job) {
      this.logDebug('message:missingJob', { requestId: data.requestId })
      return
    }

    this.pendingJobs.delete(data.requestId)

    try {
      this.logDebug('message:rendered', {
        requestId: data.requestId,
        canvasId: job.canvas.id,
        width: data.width,
        height: data.height,
      })
      void this.paintCpuPreview(job.canvas, data)
        .then(job.resolve)
        .catch(job.reject)
    } catch (error) {
      this.logDebug('message:paintError', {
        requestId: data.requestId,
        canvasId: job.canvas.id,
        error,
      })
      job.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private handleError = (event: ErrorEvent) => {
    if (this.disposed) return
    const message = event.message || 'Preview worker error'
    this.logDebug('worker:error', { message })

    this.pendingJobs.forEach(({ reject }) => {
      reject(new Error(message))
    })
    this.pendingJobs.clear()
    this.cleanup()
  }

  private async paintCpuPreview(
    canvas: HTMLCanvasElement,
    data: WorkerRenderedMessage,
  ) {
    this.logDebug('paintCpuPreview:start', {
      canvasId: canvas.id,
      width: data.width,
      height: data.height,
    })

    const pixelBuffer = new Uint8ClampedArray(data.imageData)
    const imageData = new ImageData(pixelBuffer, data.width, data.height)

    const offscreen = new OffscreenCanvas(data.width, data.height)
    const ctx = offscreen.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to create offscreen context for preview')
    }
    ctx.putImageData(imageData, 0, 0)

    const blob = await offscreen.convertToBlob({ type: 'image/png' })
    if (!blob) {
      throw new Error('Failed to convert preview to blob')
    }

    const url = URL.createObjectURL(blob)
    const previousUrl = this.objectUrlByCanvas.get(canvas)
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl)
    }

    canvas.style.backgroundImage = `url(${url})`
    canvas.style.backgroundSize = '100% 100%'
    canvas.style.backgroundRepeat = 'no-repeat'
    canvas.style.backgroundPosition = 'center'
    this.objectUrlByCanvas.set(canvas, url)
    canvas.dataset.previewImageUrl = url
    canvas.dataset.previewMode = 'cpu'

    this.logDebug('paintCpuPreview:complete', {
      canvasId: canvas.id,
      url,
    })
  }

  private logDebug(message: string, details?: Record<string, unknown>) {
    if (!this.debug) return
    const timestamp = new Date().toISOString()
    if (details) {
      console.log(`[${timestamp}] PreviewCpuRenderer:${message}`, details)
    } else {
      console.log(`[${timestamp}] PreviewCpuRenderer:${message}`)
    }
  }
}
