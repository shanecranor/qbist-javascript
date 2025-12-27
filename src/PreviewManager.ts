import { type FormulaInfo } from './qbist.ts'
import { PreviewCpuRenderer } from './PreviewCpuRenderer.ts'
import { QbistRenderer } from './QbistRenderer.ts'

function logDebug(message: string, ...args: unknown[]) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] PreviewManager:${message}`, ...args)
}

type RenderPreviewMode = 'standard' | 'warmup'

interface RenderPreviewOptions {
  mode?: RenderPreviewMode
  delayMs?: number
  generation?: number
}

const DEFAULT_MODE = 'standard' as const
const DEFAULT_DELAY_MS = 0 as const

export class PreviewManager {
  private previewRenderer = new PreviewCpuRenderer()
  private renderers = new Map<HTMLCanvasElement, QbistRenderer>()
  private previewWarmupGeneration = 0
  private useWebGl = true

  cleanup() {
    this.previewRenderer.cleanup()
    this.renderers.forEach((r) => r.cleanup())
    this.renderers.clear()
  }

  setUseWebGl(enabled: boolean) {
    if (this.useWebGl === enabled) {
      return
    }
    this.useWebGl = enabled

    const previewCanvases = Array.from(
      document.querySelectorAll<HTMLCanvasElement>('.preview'),
    )

    if (!enabled) {
      this.renderers.forEach((renderer, canvas) => {
        renderer.cleanup()
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      })
      this.renderers.clear()
      previewCanvases.forEach((canvas) => {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
        this.previewRenderer.releaseCanvas(canvas)
      })
    } else {
      previewCanvases.forEach((canvas) => {
        this.previewRenderer.releaseCanvas(canvas)
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      })
    }
  }

  getRenderer(canvas: HTMLCanvasElement) {
    if (!this.useWebGl) {
      throw new Error('WebGL previews disabled')
    }
    let renderer = this.renderers.get(canvas)
    if (!renderer) {
      renderer = new QbistRenderer(canvas)
      this.renderers.set(canvas, renderer)
    }
    return renderer
  }

  async updatePreviews(formulas: FormulaInfo[], shouldUseWarmup: boolean) {
    this.previewWarmupGeneration += 1
    const currentGeneration = this.previewWarmupGeneration

    if (shouldUseWarmup) {
      await this.startPreviewsWithWarmup(formulas, currentGeneration)
    } else {
      await this.startPreviewsDirectly(formulas, currentGeneration)
    }
  }

  private async startPreviewsWithWarmup(
    formulas: FormulaInfo[],
    generation: number,
  ) {
    for (let i = 0; i < 9; i++) {
      // Run in parallel effectively - don't await each one sequentially in the loop for the initial dispatch
      void this.renderPreviewCpu(i, formulas[i])
        .then(() => {
          this.queuePreviewWarmup(i, formulas[i], generation)
        })
        .catch((error) => {
          logDebug('startPreviewsWithWarmup:cpuPreviewError', {
            index: i,
            error,
          })
        })
    }
  }

  private async startPreviewsDirectly(
    formulas: FormulaInfo[],
    generation: number,
  ) {
    const promises = []
    for (let i = 0; i < 9; i++) {
      // We use a "fire and forget" strategy for the actual render call to let them run in parallel
      // but we track promises if we wanted to wait for them.
      // However, the original logic interleaved them.
      // Here we will just trigger them.
      promises.push(this.renderOrchestrated(i, formulas[i], generation))
    }
    await Promise.all(promises)
  }

  private async renderOrchestrated(
    i: number,
    formula: FormulaInfo,
    generation: number,
  ) {
    if (!this.useWebGl) {
      await this.renderPreviewCpu(i, formula)
      return
    }
    const element = document.getElementById(`preview${i}`)
    if (!(element instanceof HTMLCanvasElement)) return

    if (element.dataset.previewMode === 'webgl') {
      await this.renderPreviewWebGl(i, formula, { generation })
    } else {
      await this.renderPreviewCpu(i, formula)
      await this.renderPreviewWebGl(i, formula, { generation })
    }
  }

  private renderPreviewCpu(index: number, formula: FormulaInfo) {
    const canvas = document.getElementById(`preview${index}`)
    if (!(canvas instanceof HTMLCanvasElement)) {
      return Promise.resolve()
    }

    return this.previewRenderer
      .render(canvas, formula)
      .then(() => {
        canvas.dataset.previewMode = 'cpu'
      })
      .catch((err: unknown) => {
        logDebug(`renderPreviewCpu:error`, { index, error: err })
      })
  }

  private queuePreviewWarmup(
    index: number,
    formula: FormulaInfo,
    generation: number,
  ) {
    if (!this.useWebGl) {
      return
    }
    if (generation !== this.previewWarmupGeneration) {
      return
    }

    void this.renderPreviewWebGl(index, formula, {
      mode: 'warmup',
      delayMs: index * 40,
      generation,
    }).catch((error) => {
      logDebug('queuePreviewWarmup:error', { index, error })
    })
  }

  private async renderPreviewWebGl(
    index: number,
    formula: FormulaInfo,
    options: RenderPreviewOptions = {},
  ) {
    if (!this.useWebGl) {
      await this.renderPreviewCpu(index, formula)
      return
    }
    const {
      mode = DEFAULT_MODE,
      delayMs = DEFAULT_DELAY_MS,
      generation,
    } = options
    const element = document.getElementById(`preview${index}`)
    if (!(element instanceof HTMLCanvasElement)) {
      return
    }

    if (delayMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs))
    }

    try {
      await QbistRenderer.ensureWorkerResponsive()
      const canvas = element

      let pendingRelease: (() => void) | null = null
      if (canvas.dataset.previewMode === 'cpu') {
        if (mode === 'standard') {
          pendingRelease = () => this.previewRenderer.releaseCanvas(canvas)
        }
      }

      await this.getRenderer(canvas).render(formula, {
        keepAlive: false,
        refreshEveryFrame: false,
      })

      if (
        generation !== undefined &&
        generation !== this.previewWarmupGeneration
      ) {
        return
      }

      if (pendingRelease) {
        pendingRelease()
      }

      if (mode === 'warmup') {
        canvas.dataset.previewWarmup = 'complete'
        const releaseAfterWarmup = () => {
          if (
            generation !== undefined &&
            generation !== this.previewWarmupGeneration
          ) {
            return
          }
          if (canvas.dataset.previewMode === 'webgl') {
            return
          }
          this.previewRenderer.releaseCanvas(canvas)
          canvas.dataset.previewMode = 'webgl'
        }

        if (canvas.dataset.previewMode === 'cpu') {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(releaseAfterWarmup)
          })
        } else {
          releaseAfterWarmup()
        }
      } else {
        canvas.dataset.previewMode = 'webgl'
      }
    } catch (error: unknown) {
      logDebug(`renderPreviewWebGl:fallbackToCpu`, { index, error })
      await this.renderPreviewCpu(index, formula)
    }
  }
}
