import { optimize, qbist } from "./qbist.ts"
// --- Worker Message Handling ---
// Receives a "render" command with payload and sends back the computed image data.
self.addEventListener("message", (e) => {
  const data = e.data
  if (data.command === "render") {
    const { info, width, height, oversampling = 1 } = data
    const { usedTransFlag, usedRegFlag } = optimize(info)
    const buffer = new Uint8ClampedArray(width * height * 4)

    for (let y = 0; y < height; y++) {
      const progress = Math.floor((y / height) * 100)
      if (height > 256) {
        self.postMessage({ command: "progress", progress })
      }
      for (let x = 0; x < width; x++) {
        const color = qbist(
          info,
          x,
          y,
          width,
          height,
          oversampling,
          usedTransFlag,
          usedRegFlag
        )
        const r = Math.floor(color[0] * 255)
        const g = Math.floor(color[1] * 255)
        const b = Math.floor(color[2] * 255)
        const idx = (y * width + x) * 4
        buffer[idx] = r
        buffer[idx + 1] = g
        buffer[idx + 2] = b
        buffer[idx + 3] = 255
      }
    }

    // Transfer the image data buffer back to the main thread
    self.postMessage(
      { command: "rendered", imageData: buffer.buffer, width, height },
      [buffer.buffer]
    )
  }
})
