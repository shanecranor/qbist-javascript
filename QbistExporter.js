import { QbistRenderer } from "./QbistRenderer.js"
export class QbistExporter {
  constructor() {
    this.exportCanvas = null
    this.renderer = null
  }

  async exportImage(info, width, height) {
    try {
      this.cleanup()

      this.exportCanvas = document.createElement("canvas")
      this.exportCanvas.id = "exportCanvas"
      this.exportCanvas.width = width
      this.exportCanvas.height = height
      document.body.appendChild(this.exportCanvas)
      console.log(`[Canvas Create] Created export canvas ${width}x${height}`)

      this.renderer = new QbistRenderer(this.exportCanvas)
      const result = await this.renderer.render(info, { isExport: true })

      if (result.kind === "bitmap") {
        const link = document.createElement("a")
        const tempCanvas = document.createElement("canvas")
        tempCanvas.width = width
        tempCanvas.height = height
        console.log(
          `[Canvas Create] Created temporary canvas for export ${width}x${height}`
        )

        const ctx = tempCanvas.getContext("2d")
        ctx.drawImage(result.bitmap, 0, 0)

        link.href = tempCanvas.toDataURL("image/png")
        link.download = "qbist.png"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        console.log(`[Canvas Delete] Removed temporary canvas`)
      }
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
