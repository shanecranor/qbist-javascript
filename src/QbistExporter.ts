import type { FormulaInfo } from "./qbist.ts"
import { QbistRenderer } from "./QbistRenderer.ts"

export class QbistExporter {
  exportCanvas: HTMLCanvasElement | null
  renderer: QbistRenderer | null

  constructor() {
    this.exportCanvas = null
    this.renderer = null
  }

  async exportImage(info: FormulaInfo, width: number, height: number) {
    try {
      this.cleanup()
      this.exportCanvas = document.createElement("canvas")
      this.exportCanvas.id = "exportCanvas"
      this.exportCanvas.width = width
      this.exportCanvas.height = height
      document.body.appendChild(this.exportCanvas)
      console.log(`[Canvas Create] Created export canvas ${width}x${height}`)

      this.renderer = new QbistRenderer(this.exportCanvas)
      await this.renderer.render(info, {
        isExport: true,
      })

      // At this point, the renderer has drawn the image onto the canvas.
      const dataUrl = this.exportCanvas.toDataURL("image/png")
      const link = document.createElement("a")
      link.href = dataUrl
      link.download = "qbist.png"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
    } finally {
      this.cleanup()
    }
  }

  cleanup() {
    if (this.renderer) {
      this.renderer.cleanup()
      this.renderer = null
    }
    if (this.exportCanvas && this.exportCanvas.parentNode) {
      console.log(`[Canvas Delete] Removed export canvas`)
      document.body.removeChild(this.exportCanvas)
      this.exportCanvas = null
    }
  }
}

