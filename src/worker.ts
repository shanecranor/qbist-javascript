/// <reference lib="webworker" />

import { optimize, qbist } from "./qbist.ts"
import type { FormulaInfo } from "./qbist.ts"

type RenderCommandMessage = {
  command: "render"
  requestId: number
  info: FormulaInfo
  width: number
  height: number
  oversampling?: number
}

type WorkerMessage = RenderCommandMessage

type ProgressMessage = {
  command: "progress"
  requestId: number
  progress: number
}

type RenderedMessage = {
  command: "rendered"
  requestId: number
  imageData: ArrayBuffer
  width: number
  height: number
}

const ctx = self as DedicatedWorkerGlobalScope

ctx.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const data = event.data
  if (data.command !== "render") return

  const { requestId, info, width, height, oversampling = 1 } = data
  const { usedTransFlag, usedRegFlag } = optimize(info)
  const buffer = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    const progress = Math.floor((y / height) * 100)
    if (height > 256) {
      ctx.postMessage({ command: "progress", requestId, progress } satisfies ProgressMessage)
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

  ctx.postMessage(
    {
      command: "rendered",
      requestId,
      imageData: buffer.buffer,
      width,
      height,
    } satisfies RenderedMessage,
    [buffer.buffer]
  )
})

export {}
