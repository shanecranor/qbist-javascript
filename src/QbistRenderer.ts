import type { FormulaInfo } from './qbist.ts'
import WebGlWorker from './workerWebGL.ts?worker'

export interface RenderOptions {
  keepAlive?: boolean
  refreshEveryFrame?: boolean
  isExport?: boolean
}

export type RenderResult =
  | {
      command: 'rendered'
      keepAlive?: boolean
      kind: 'bitmap'
      bitmap: ImageBitmap
    }
  | {
      command: 'rendered'
      keepAlive?: boolean
      kind: 'pixels'
      pixels: ArrayBuffer
      width: number
      height: number
    }
  | {
      command: 'rendered'
      keepAlive?: boolean
      kind?: undefined
    }

type WorkerRenderedMessage = RenderResult & {
  canvasId: string
  requestId: number
  keepAlive: boolean
}

type WorkerErrorMessage = {
  command: 'error'
  canvasId: string
  requestId: number
  message: string
}

type WorkerPongMessage = {
  command: 'pong'
  pingId: number
}

type WorkerMessageData =
  | WorkerRenderedMessage
  | WorkerErrorMessage
  | WorkerPongMessage

export type WorkerFailureHandler = (error: Error) => void

interface PendingRequest {
  resolve: (result: RenderResult) => void
  reject: (error: Error) => void
  keepAlive: boolean
  isExport: boolean
}

interface PendingPing {
  resolve: () => void
  reject: (error: Error) => void
}

let sharedWorker: Worker | null = null
let workerMessageListener:
  | ((event: MessageEvent<WorkerMessageData>) => void)
  | null = null
let workerErrorListener: ((event: ErrorEvent) => void) | null = null
let nextRequestId = 1
let nextRendererId = 1
let nextPingId = 1
const pendingPings = new Map<number, PendingPing>()
let workerResponsive = false
let workerResponsivePromise: Promise<void> | null = null
const failureHandlers = new Set<WorkerFailureHandler>()

const rendererRegistry = new Map<string, QbistRenderer>()

function rejectPendingPings(error: Error) {
  pendingPings.forEach((pending) => {
    pending.reject(error)
  })
  pendingPings.clear()
  workerResponsivePromise = null
  workerResponsive = false
}

function ensureSharedWorker(): Worker {
  if (!sharedWorker) {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not supported in this browser')
    }
    sharedWorker = new WebGlWorker()
    workerMessageListener = (event: MessageEvent<WorkerMessageData>) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if ('command' in data && data.command === 'pong') {
        const pending = pendingPings.get(data.pingId)
        if (pending) {
          pending.resolve()
        }
        return
      }
      const canvasId = 'canvasId' in data ? data.canvasId : undefined
      if (!canvasId) return
      const renderer = rendererRegistry.get(canvasId)
      renderer?.receiveWorkerMessage(data)
    }
    workerErrorListener = (event: ErrorEvent) => {
      console.error('WebGL worker error:', event.message, event.error)
      const error = new Error(event.message || 'WebGL worker error')
      rejectPendingPings(error)
      rendererRegistry.forEach((renderer) => renderer.handleWorkerFailure())
      failureHandlers.forEach((handler) => handler(error))
    }
    sharedWorker.addEventListener('message', workerMessageListener)
    sharedWorker.addEventListener('error', workerErrorListener)
  }
  return sharedWorker
}

export class QbistRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private rendererId: string
  private keepAlive: boolean
  private pendingRequests: Map<number, PendingRequest>
  private activeRequestId: number | null
  private worker: Worker | null
  private onFailure: WorkerFailureHandler | null

  constructor(canvas: HTMLCanvasElement, onFailure?: WorkerFailureHandler) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')

    if (!this.ctx) {
      // Could happen if the canvas was transferred to the worker previously (like in a hot reload)
      console.warn(
        `Could not get 2D context for canvas ${canvas.id}. It might have been transferred previously.`,
      )
    }

    const existingId =
      canvas.dataset.qbistRendererId &&
      canvas.dataset.qbistRendererId.length > 0
        ? canvas.dataset.qbistRendererId
        : canvas.id
    this.rendererId =
      existingId && existingId.length > 0
        ? existingId
        : `qbist-canvas-${nextRendererId++}`
    canvas.dataset.qbistRendererId = this.rendererId

    this.keepAlive = false
    this.pendingRequests = new Map()
    this.activeRequestId = null
    this.worker = ensureSharedWorker()
    this.onFailure = onFailure ?? null
    if (this.onFailure) {
      failureHandlers.add(this.onFailure)
    }

    rendererRegistry.set(this.rendererId, this)
    console.log(
      `[Canvas Create] Created renderer for canvas ${canvas.id || this.rendererId}`,
    )
  }

  static ensureWorkerResponsive(timeout = 1000): Promise<void> {
    if (workerResponsive) {
      return Promise.resolve()
    }
    if (workerResponsivePromise) {
      return workerResponsivePromise
    }

    const worker = ensureSharedWorker()
    const pingId = nextPingId++

    workerResponsivePromise = new Promise<void>((resolve, reject) => {
      const timeoutError = new Error('WebGL worker unresponsive')
      const timer = setTimeout(() => {
        const pending = pendingPings.get(pingId)
        if (pending) {
          pending.reject(timeoutError)
        }
      }, timeout)

      const pending: PendingPing = {
        resolve: () => {
          clearTimeout(timer)
          pendingPings.delete(pingId)
          workerResponsive = true
          workerResponsivePromise = null
          resolve()
        },
        reject: (error: Error) => {
          clearTimeout(timer)
          pendingPings.delete(pingId)
          workerResponsive = false
          workerResponsivePromise = null
          reject(error)
        },
      }

      pendingPings.set(pingId, pending)

      try {
        worker.postMessage({ type: 'ping', pingId })
      } catch (error) {
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    })

    return workerResponsivePromise
  }

  async render(
    info: FormulaInfo,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    const {
      keepAlive = false,
      refreshEveryFrame = false,
      isExport = false,
    } = options

    this.keepAlive = keepAlive
    this.worker = ensureSharedWorker()

    const loadingOverlay = document.getElementById('loadingOverlay')
    const loadingBar = document.getElementById('loadingBar')

    return new Promise<RenderResult>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker is not initialized'))
        return
      }

      if (isExport && loadingOverlay && loadingBar) {
        loadingOverlay.style.display = 'flex'
        loadingBar.style.width = '100%'
      }

      const requestId = nextRequestId++
      this.activeRequestId = requestId
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        keepAlive,
        isExport,
      })

      try {
        this.worker.postMessage({
          type: 'render',
          canvasId: this.rendererId,
          requestId,
          info,
          keepAlive,
          refreshEveryFrame,
          isExport,
          width: this.canvas.width,
          height: this.canvas.height,
        })
      } catch (error) {
        this.pendingRequests.delete(requestId)
        if (isExport && loadingOverlay) {
          loadingOverlay.style.display = 'none'
        }
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  update(info: FormulaInfo) {
    if (!this.worker || this.activeRequestId === null) {
      return
    }
    this.worker.postMessage({
      type: 'update',
      canvasId: this.rendererId,
      requestId: this.activeRequestId,
      info,
      keepAlive: this.keepAlive,
      width: this.canvas.width,
      height: this.canvas.height,
    })
  }

  cleanup() {
    this.pendingRequests.forEach(({ reject }) => {
      reject(new Error('Renderer cleaned up'))
    })
    this.pendingRequests.clear()

    rendererRegistry.delete(this.rendererId)

    this.activeRequestId = null
    this.keepAlive = false
    this.worker = null
    this.ctx = null
    if (this.onFailure) {
      failureHandlers.delete(this.onFailure)
    }

    console.log(
      `[Canvas Delete] Cleaned up renderer for canvas ${this.canvas.id || this.rendererId}`,
    )
  }

  receiveWorkerMessage(data: WorkerMessageData) {
    if (data.command === 'rendered') {
      const pending = this.pendingRequests.get(data.requestId)
      if (pending) {
        this.pendingRequests.delete(data.requestId)

        if (pending.isExport) {
          const overlay = document.getElementById('loadingOverlay')
          if (overlay) overlay.style.display = 'none'
        }

        // Draw to 2D Canvas
        if (data.kind === 'bitmap' && this.ctx) {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
          this.ctx.drawImage(data.bitmap, 0, 0)
          data.bitmap.close()
        } else if (data.kind === 'pixels' && this.ctx) {
          const imageData = new ImageData(
            new Uint8ClampedArray(data.pixels),
            data.width,
            data.height,
          )
          this.ctx.putImageData(imageData, 0, 0)
        }

        pending.resolve(this.toRenderResult(data))

        if (!pending.keepAlive && this.activeRequestId === data.requestId) {
          this.activeRequestId = null
        }
      }
    } else if (data.command === 'error') {
      const pending = this.pendingRequests.get(data.requestId)
      if (pending) {
        this.pendingRequests.delete(data.requestId)
        if (pending.isExport) {
          const overlay = document.getElementById('loadingOverlay')
          if (overlay) overlay.style.display = 'none'
        }
        pending.reject(new Error(data.message))

        if (!pending.keepAlive && this.activeRequestId === data.requestId) {
          this.activeRequestId = null
        }
      } else {
        console.error(`Worker error for ${this.rendererId}:`, data.message)
      }

      const message = data.message ?? ''
      const normalized = message.toLowerCase()
      const indicatesContextFailure =
        normalized.includes('webgl2 not available') ||
        normalized.includes('failed to create webgl context') ||
        normalized.includes('webgl is currently disabled')

      if (indicatesContextFailure) {
        const error = new Error(message || 'WebGL renderer unavailable')
        if (this.onFailure) {
          this.onFailure(error)
        }
        failureHandlers.forEach((handler) => handler(error))
      }
    }
  }

  handleWorkerFailure() {
    this.pendingRequests.forEach(({ reject }) => {
      reject(new Error('WebGL worker failed'))
    })
    this.pendingRequests.clear()
    this.activeRequestId = null
    this.worker = null
    if (pendingPings.size > 0) {
      rejectPendingPings(new Error('WebGL worker failed'))
    } else {
      workerResponsivePromise = null
      workerResponsive = false
    }
    const overlay = document.getElementById('loadingOverlay')
    if (overlay) overlay.style.display = 'none'
  }

  private toRenderResult(data: WorkerRenderedMessage): RenderResult {
    return {
      command: 'rendered',
      keepAlive: data.keepAlive,
    }
  }
}
