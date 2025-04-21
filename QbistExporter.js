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
        await this.handleBitmapExport(result.bitmap, width, height)
      } else if (result.kind === "pixels") {
        await this.handlePixelExport(result.pixels, result.width, result.height)
      }
    } finally {
      this.cleanup()
    }
  }

  async handleBitmapExport(bitmap, width, height) {
    const link = document.createElement("a")
    const tempCanvas = document.createElement("canvas")
    tempCanvas.width = width
    tempCanvas.height = height
    console.log(
      `[Canvas Create] Created temporary canvas for bitmap export ${width}x${height}`
    )

    const ctx = tempCanvas.getContext("2d")
    ctx.drawImage(bitmap, 0, 0)

    link.href = tempCanvas.toDataURL("image/png")
    link.download = "qbist.png"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    console.log(`[Canvas Delete] Removed temporary canvas`)
  }

  async handlePixelExport(pixelBuffer, width, height) {
    const tempCanvas = document.createElement("canvas")
    tempCanvas.width = width
    tempCanvas.height = height
    console.log(
      `[Canvas Create] Created temporary canvas for pixel export ${width}x${height}`
    )

    const ctx = tempCanvas.getContext("2d")
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
