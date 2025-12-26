/// <reference lib="webworker" />

import { optimize, type FormulaInfo } from './qbist.ts'

const ctx = self as DedicatedWorkerGlobalScope

type UniformArrayName =
  | 'uTransformSequence'
  | 'uSource'
  | 'uControl'
  | 'uDest'
  | 'uUsedTransFlag'
  | 'uUsedRegFlag'

type UniformScalarName = 'uResolution' | 'uTime'

type RendererUniformName = UniformArrayName | UniformScalarName

type RendererUniforms = Record<RendererUniformName, WebGLUniformLocation | null>

type RenderModeType = 'interactive' | 'export' | 'animation'

interface RenderModeState {
  type: RenderModeType
  keepAlive: boolean
}

interface RendererContext {
  canvasId: string | null
  canvas: OffscreenCanvas
  gl: WebGL2RenderingContext
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  positionBuffer: WebGLBuffer
  uniforms: RendererUniforms
  renderMode: RenderModeState
  formula: FormulaInfo | null
  pendingFrame: number | null
  fpsLastTime: number
  fpsFrameCount: number
}

interface RenderPayload {
  canvasId: string
  info?: FormulaInfo
  width?: number
  height?: number
  keepAlive?: boolean
  refreshEveryFrame?: boolean
  isExport?: boolean
}

interface RenderMessage extends RenderPayload {
  type: 'render'
  requestId: number
}

interface UpdateMessage extends RenderPayload {
  type: 'update'
  requestId?: number
}

interface CleanupMessage {
  type: 'cleanup'
  canvasId?: string
}

interface InitMessage extends RenderPayload {
  type: 'init'
  canvas: OffscreenCanvas
}

interface PingMessage {
  type: 'ping'
  pingId: number
}

export type FPSMessage = {
  command: 'fps'
  fps: number
}

type WorkerMessage =
  | RenderMessage
  | UpdateMessage
  | CleanupMessage
  | PingMessage
  | InitMessage

type RenderedMessageBase = {
  command: 'rendered'
  canvasId: string
  requestId: number
  keepAlive: boolean
}

type RenderedBitmapMessage = RenderedMessageBase & {
  kind: 'bitmap'
  bitmap: ImageBitmap
}

type RenderedPixelsMessage = RenderedMessageBase & {
  kind: 'pixels'
  pixels: ArrayBuffer
  width: number
  height: number
}

export type RenderedMessage =
  | RenderedMessageBase
  | RenderedBitmapMessage
  | RenderedPixelsMessage

export type ErrorMessage = {
  command: 'error'
  canvasId: string
  requestId: number
  message: string
}

const arrayUniforms: UniformArrayName[] = [
  'uTransformSequence',
  'uSource',
  'uControl',
  'uDest',
  'uUsedTransFlag',
  'uUsedRegFlag',
]

const scalarUniforms: UniformScalarName[] = ['uResolution', 'uTime']

type FrameHandle = number
type FrameScheduler = (callback: (time: number) => void) => FrameHandle

const requestFrame: FrameScheduler =
  typeof ctx.requestAnimationFrame === 'function'
    ? ctx.requestAnimationFrame.bind(ctx)
    : (callback) => setTimeout(() => callback(performance.now()), 16)

const cancelFrame: (handle: FrameHandle) => void =
  typeof ctx.cancelAnimationFrame === 'function'
    ? ctx.cancelAnimationFrame.bind(ctx)
    : (handle) => clearTimeout(handle)

// Singleton Context
let singletonContext: RendererContext | null = null

function ensureSingletonContext(canvas?: OffscreenCanvas): RendererContext {
  if (singletonContext) return singletonContext

  // Use provided canvas or create a default one
  const contextCanvas = canvas || new OffscreenCanvas(256, 256)

  const gl = contextCanvas.getContext('webgl2', {
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
    depth: false,
    stencil: false,
  }) as WebGL2RenderingContext | null

  if (!gl) {
    throw new Error('WebGL2 not available')
  }

  const program = createProgram(gl)
  const { vao, positionBuffer } = initGeometry(gl, program)
  const uniforms = initUniforms(gl, program)

  gl.useProgram(program)

  singletonContext = {
    canvasId: null,
    canvas: contextCanvas,
    gl,
    program,
    vao,
    positionBuffer,
    uniforms,
    renderMode: { type: 'interactive', keepAlive: false },
    formula: null,
    pendingFrame: null,
    fpsLastTime: performance.now(),
    fpsFrameCount: 0,
  }

  return singletonContext
}

ctx.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const message = event.data

  try {
    switch (message.type) {
      case 'init':
        handleInitMessage(message)
        break
      case 'render':
        handleRenderMessage(message)
        break
      case 'update':
        handleRenderMessage(message)
        break
      case 'cleanup':
        if (singletonContext && singletonContext.pendingFrame !== null) {
          cancelFrame(singletonContext.pendingFrame)
          singletonContext.pendingFrame = null
        }
        break
      case 'ping':
        ctx.postMessage({ command: 'pong', pingId: message.pingId })
        break
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error('Worker error:', err)
    const canvasId =
      'canvasId' in message && typeof message.canvasId === 'string'
        ? message.canvasId
        : 'unknown'
    const requestId =
      'requestId' in message && typeof message.requestId === 'number'
        ? message.requestId
        : -1
    sendRenderError(canvasId, requestId, err)
  }
})

function handleInitMessage(message: InitMessage) {
  const context = ensureSingletonContext(message.canvas)

  const requestId = 0

  if (message.info) {
    uploadFormula(context, message.info)
  }

  // Trigger initial render/animation loop
  handleRenderMessage({
    type: 'render',
    requestId,
    canvasId: 'animation',
    width: message.width,
    height: message.height,
    info: message.info,
    keepAlive: message.keepAlive,
  })
}

function handleRenderMessage(message: RenderMessage | UpdateMessage) {
  const context = ensureSingletonContext()

  context.canvasId = message.canvasId

  if (context.pendingFrame !== null) {
    cancelFrame(context.pendingFrame)
    context.pendingFrame = null
  }

  const requestId =
    'requestId' in message && typeof message.requestId === 'number'
      ? message.requestId
      : 0

  if (typeof message.width === 'number' && typeof message.height === 'number') {
    resizeCanvas(context, message.width, message.height)
  }

  if (message.info) {
    uploadFormula(context, message.info)
  }

  if (!context.formula) {
    throw new Error('No formula provided for rendering')
  }

  const keepAlive =
    typeof message.keepAlive === 'boolean'
      ? message.keepAlive
      : context.renderMode.keepAlive

  const isExport = Boolean(message.isExport)
  const renderType: RenderModeType = isExport
    ? 'export'
    : keepAlive
      ? 'animation'
      : 'interactive'

  context.renderMode = {
    type: renderType,
    keepAlive,
  }

  if (context.renderMode.type === 'animation') {
    const step = (time: number) => {
      void renderFrame(context, requestId, time, isExport)
        .then(() => {
          if (
            context.renderMode.type === 'animation' &&
            context.renderMode.keepAlive
          ) {
            context.pendingFrame = requestFrame(step)
          } else {
            context.pendingFrame = null
          }
        })
        .catch((error: unknown) => {
          context.pendingFrame = null
          sendRenderError(context.canvasId!, requestId, error)
        })

      // Calculate FPS
      context.fpsFrameCount++
      const now = performance.now()
      if (now - context.fpsLastTime >= 1000) {
        const fps = (context.fpsFrameCount * 1000) / (now - context.fpsLastTime)
        ctx.postMessage({ command: 'fps', fps } satisfies FPSMessage)
        context.fpsLastTime = now
        context.fpsFrameCount = 0
      }
    }
    context.pendingFrame = requestFrame(step)
  } else {
    void renderFrame(context, requestId, performance.now(), isExport).catch(
      (error: unknown) => {
        sendRenderError(context.canvasId!, requestId, error)
      },
    )
  }
}

async function renderFrame(
  context: RendererContext,
  requestId: number,
  timestamp: number,
  isExport: boolean,
) {
  const { gl, program, vao, uniforms, renderMode } = context

  gl.useProgram(program)
  gl.bindVertexArray(vao)

  if (uniforms.uTime) {
    const timeValue = renderMode.type === 'animation' ? timestamp * 0.001 : 0
    gl.uniform1f(uniforms.uTime, timeValue)
  }

  gl.viewport(0, 0, context.canvas.width, context.canvas.height)
  gl.drawArrays(gl.TRIANGLES, 0, 6)

  await exportFromContext(context, requestId)

  if (renderMode.type === 'export' || isExport) {
    context.renderMode = { type: 'interactive', keepAlive: false }
  }
}

function resizeCanvas(context: RendererContext, width: number, height: number) {
  if (context.canvas.width !== width || context.canvas.height !== height) {
    context.canvas.width = width
    context.canvas.height = height
  }

  const uniform = context.uniforms.uResolution
  if (uniform) {
    context.gl.useProgram(context.program)
    context.gl.uniform2i(uniform, width, height)
  }
}

function uploadFormula(context: RendererContext, info: FormulaInfo) {
  const { gl, uniforms } = context
  gl.useProgram(context.program)
  const { usedTransFlag, usedRegFlag } = optimize(info)

  if (uniforms.uTransformSequence) {
    gl.uniform1iv(
      uniforms.uTransformSequence,
      new Int32Array(info.transformSequence),
    )
  }
  if (uniforms.uSource) {
    gl.uniform1iv(uniforms.uSource, new Int32Array(info.source))
  }
  if (uniforms.uControl) {
    gl.uniform1iv(uniforms.uControl, new Int32Array(info.control))
  }
  if (uniforms.uDest) {
    gl.uniform1iv(uniforms.uDest, new Int32Array(info.dest))
  }
  if (uniforms.uUsedTransFlag) {
    gl.uniform1iv(
      uniforms.uUsedTransFlag,
      new Int32Array(usedTransFlag.map((flag) => (flag ? 1 : 0))),
    )
  }
  if (uniforms.uUsedRegFlag) {
    gl.uniform1iv(
      uniforms.uUsedRegFlag,
      new Int32Array(usedRegFlag.map((flag) => (flag ? 1 : 0))),
    )
  }

  context.formula = info
}

async function exportFromContext(context: RendererContext, requestId: number) {
  const { gl, canvas, canvasId } = context
  gl.finish()

  try {
    const bitmap = canvas.transferToImageBitmap()

    ctx.postMessage(
      {
        command: 'rendered',
        canvasId: canvasId!,
        requestId,
        keepAlive: context.renderMode.keepAlive,
        kind: 'bitmap',
        bitmap,
      } satisfies RenderedBitmapMessage,
      [bitmap],
    )
    return
  } catch (error) {
    console.warn('Falling back to raw pixel export', error)
  }

  const width = canvas.width
  const height = canvas.height
  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

  ctx.postMessage(
    {
      command: 'rendered',
      canvasId: canvasId!,
      requestId,
      keepAlive: context.renderMode.keepAlive,
      kind: 'pixels',
      pixels: pixels.buffer,
      width,
      height,
    } satisfies RenderedPixelsMessage,
    [pixels.buffer],
  )
}

function sendRenderError(canvasId: string, requestId: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  ctx.postMessage({
    command: 'error',
    canvasId,
    requestId,
    message,
  } satisfies ErrorMessage)
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertexSource = `#version 300 es
    in vec2 aPosition;
    out vec2 vUV;
    void main() {
      vUV = vec2(aPosition.x + 1.0, -aPosition.y + 1.0) * 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`

  const fragmentSource = `#version 300 es
    precision highp float;
    precision highp int;
    in vec2 vUV;
    uniform ivec2 uResolution;
    uniform float uTime;
    uniform int uTransformSequence[36];
    uniform int uSource[36];
    uniform int uControl[36];
    uniform int uDest[36];
    uniform int uUsedTransFlag[36];
    uniform int uUsedRegFlag[6];
    out vec4 outColor;

    #define OVERSAMPLING 2
    const int MAX_TRANSFORMS = 36;
    const int NUM_REGISTERS = 6;

    void main() {
      vec2 pixelCoord = vUV * vec2(uResolution);
      vec3 accum = vec3(0.0);

      for (int oy = 0; oy < OVERSAMPLING; oy++) {
        for (int ox = 0; ox < OVERSAMPLING; ox++) {
          vec2 subPixelPos = (floor(pixelCoord) * float(OVERSAMPLING) + vec2(float(ox), float(oy))) / (vec2(uResolution) * float(OVERSAMPLING));

          vec3 r[NUM_REGISTERS];
          for (int i = 0; i < NUM_REGISTERS; i++) {
             if (uUsedRegFlag[i] == 1) {
                // Add some circular motion and phase shifts based on register index
                float phase = float(i) * 1.0;
                float t = uTime * 0.2;
                vec3 offset = vec3(
                   0.1 * sin(t + phase),
                   0.1 * cos(t + phase * 0.5),
                   t * 0.1
                );
                r[i] = vec3(subPixelPos.x, subPixelPos.y, float(i) / float(NUM_REGISTERS)) + offset;
             } else {
               r[i] = vec3(0.0);
             }
          }

          for (int i = 0; i < MAX_TRANSFORMS; i++) {
             if (uUsedTransFlag[i] != 1) continue;
            int t = uTransformSequence[i];
            int sr = uSource[i];
            int cr = uControl[i];
            int dr = uDest[i];
            vec3 src = r[sr];
            vec3 ctrl = r[cr];
            if (t == 0) {
              float scalarProd = dot(src, ctrl);
              r[dr] = src * scalarProd;
            } else if (t == 1) {
              vec3 sum = src + ctrl;
              r[dr] = sum - step(vec3(1.0), sum);
            } else if (t == 2) {
              vec3 diff = src - ctrl;
              r[dr] = diff + step(diff, vec3(0.0));
            } else if (t == 3) {
              r[dr] = vec3(src.y, src.z, src.x);
            } else if (t == 4) {
              r[dr] = vec3(src.z, src.x, src.y);
            } else if (t == 5) {
              r[dr] = src * ctrl;
            } else if (t == 6) {
              r[dr] = vec3(0.5) + 0.5 * sin(20.0 * src * ctrl);
            } else if (t == 7) {
              float sum = ctrl.x + ctrl.y + ctrl.z;
              r[dr] = (sum > 0.5) ? src : ctrl;
            } else if (t == 8) {
              r[dr] = vec3(1.0) - src;
            }
          }
          accum += r[0];
        }
      }
      vec3 color = accum / float(OVERSAMPLING * OVERSAMPLING);
      outColor = vec4(color, 1.0);
    }`

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)

  const program = gl.createProgram()
  if (!program) {
    throw new Error('Failed to create WebGL program')
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const infoLog =
      gl.getProgramInfoLog(program) ?? 'Unknown program link error'
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    gl.deleteProgram(program)
    throw new Error(infoLog)
  }

  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  return program
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Failed to create shader')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const infoLog =
      gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error'
    gl.deleteShader(shader)
    throw new Error(infoLog)
  }
  return shader
}

function initGeometry(gl: WebGL2RenderingContext, program: WebGLProgram) {
  const quadVertices = new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ])

  const vao = gl.createVertexArray()
  if (!vao) {
    throw new Error('Failed to create vertex array object')
  }
  gl.bindVertexArray(vao)

  const positionBuffer = gl.createBuffer()
  if (!positionBuffer) {
    gl.deleteVertexArray(vao)
    throw new Error('Failed to create position buffer')
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)

  const positionLocation = gl.getAttribLocation(program, 'aPosition')
  if (positionLocation === -1) {
    gl.deleteVertexArray(vao)
    gl.deleteBuffer(positionBuffer)
    throw new Error('Failed to get attribute location for aPosition')
  }

  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  return { vao, positionBuffer }
}

function initUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): RendererUniforms {
  const uniforms: RendererUniforms = {
    uResolution: null,
    uTime: null,
    uTransformSequence: null,
    uSource: null,
    uControl: null,
    uDest: null,
    uUsedTransFlag: null,
    uUsedRegFlag: null,
  }

  arrayUniforms.forEach((name) => {
    uniforms[name] =
      gl.getUniformLocation(program, `${name}[0]`) ||
      gl.getUniformLocation(program, name)
    if (uniforms[name] === null) {
      console.error(`Failed to get uniform location for ${name}`)
    }
  })

  scalarUniforms.forEach((name) => {
    uniforms[name] = gl.getUniformLocation(program, name)
    if (uniforms[name] === null) {
      console.error(`Failed to get uniform location for ${name}`)
    }
  })

  return uniforms
}

export {}
