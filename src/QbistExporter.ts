import type { FormulaInfo } from "./qbist.js"
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
      const result = await this.renderer.render(info, { isExport: true })

      if (result.kind === "bitmap") {
        await this.handleBitmapExport(result.bitmap, width, height)
      } else if (result.kind === "pixels") {
        await this.handlePixelExport(result.pixels, result.width, result.height)
      }
    } finally {
      this.cleanup()
    }
  }

  async handleBitmapExport(
    bitmap: HTMLImageElement,
    width: number,
    height: number
  ) {
    const link = document.createElement("a")
    const tempCanvas = document.createElement("canvas")
    tempCanvas.width = width
    tempCanvas.height = height
    console.log(
      `[Canvas Create] Created temporary canvas for bitmap export ${width}x${height}`
    )

    const ctx = tempCanvas.getContext("2d")
    if (!ctx) throw new Error("Failed to get canvas context")
    ctx.drawImage(bitmap, 0, 0)

    link.href = tempCanvas.toDataURL("image/png")
    link.download = "qbist.png"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    console.log(`[Canvas Delete] Removed temporary canvas`)
  }

  async handlePixelExport(
    pixelBuffer: ArrayBuffer,
    width: number,
    height: number
  ) {
    const tempCanvas = document.createElement("canvas")
    tempCanvas.width = width
    tempCanvas.height = height
    console.log(
      `[Canvas Create] Created temporary canvas for pixel export ${width}x${height}`
    )

    const ctx = tempCanvas.getContext("2d")
    if (!ctx) throw new Error("Failed to get canvas context")
    const imageData = new ImageData(
      new Uint8ClampedArray(pixelBuffer),
      width,
      height
    )

    // Need to flip the image vertically since WebGL reads pixels from bottom-left
    const flippedCanvas = document.createElement("canvas")
    flippedCanvas.width = width
    flippedCanvas.height = height
    const flippedCtx = flippedCanvas.getContext("2d")
    if (!flippedCtx) throw new Error("Failed to get flipped canvas context")

    // Put the pixels on the temporary canvas
    ctx.putImageData(imageData, 0, 0)

    // Flip the image by drawing it upside down
    flippedCtx.scale(1, -1)
    flippedCtx.drawImage(tempCanvas, 0, -height)

    const link = document.createElement("a")
    link.href = flippedCanvas.toDataURL("image/png")
    link.download = "qbist.png"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    console.log(`[Canvas Delete] Removed temporary canvases`)
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
