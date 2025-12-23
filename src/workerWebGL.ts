/// <reference lib="webworker" />

import { optimize, type FormulaInfo } from "./qbist.ts"

const ctx = self as DedicatedWorkerGlobalScope

type UniformArrayName =
  | "uTransformSequence"
  | "uSource"
  | "uControl"
  | "uDest"
  | "uUsedTransFlag"
  | "uUsedRegFlag"

type UniformScalarName = "uResolution" | "uTime"

type RendererUniformName = UniformArrayName | UniformScalarName

type RendererUniforms = Record<RendererUniformName, WebGLUniformLocation | null>

type RenderModeType = "interactive" | "export" | "animation"

interface RenderModeState {
  type: RenderModeType
  keepAlive: boolean
}

interface RendererStateShape {
  gl: WebGL2RenderingContext | null
  program: WebGLProgram | null
  vao: WebGLVertexArrayObject | null
  positionBuffer: WebGLBuffer | null
  uniforms: RendererUniforms
  renderMode: RenderModeState
  formula: FormulaInfo | null
  needsRender: boolean
  frameCount: number
  lastFpsUpdate: number
  fpsUpdateInterval: number
}

interface InitMessage {
  type: "init"
  canvas: OffscreenCanvas
  info: FormulaInfo
  keepAlive: boolean
  refreshEveryFrame?: boolean
  isExport?: boolean
  width?: number
  height?: number
}

interface UpdateMessage {
  type: "update"
  info?: FormulaInfo
  keepAlive?: boolean
  refreshEveryFrame?: boolean
  isExport?: boolean
  width?: number
  height?: number
}

interface CleanupMessage {
  type: "cleanup"
}

type WorkerMessage = InitMessage | UpdateMessage | CleanupMessage

type RenderedMessageBase = {
  command: "rendered"
  keepAlive: boolean
}

type RenderedBitmapMessage = RenderedMessageBase & {
  kind: "bitmap"
  bitmap: ImageBitmap
}

type RenderedPixelMessage = RenderedMessageBase & {
  kind: "pixels"
  pixels: ArrayBuffer
  width: number
  height: number
}

const arrayUniforms: UniformArrayName[] = [
  "uTransformSequence",
  "uSource",
  "uControl",
  "uDest",
  "uUsedTransFlag",
  "uUsedRegFlag",
]

const scalarUniforms: UniformScalarName[] = ["uResolution", "uTime"]

function createEmptyUniforms(): RendererUniforms {
  return {
    uResolution: null,
    uTime: null,
    uTransformSequence: null,
    uSource: null,
    uControl: null,
    uDest: null,
    uUsedTransFlag: null,
    uUsedRegFlag: null,
  }
}

const RendererState: RendererStateShape = {
  gl: null,
  program: null,
  vao: null,
  positionBuffer: null,
  uniforms: createEmptyUniforms(),
  renderMode: { type: "interactive", keepAlive: false },
  formula: null,
  needsRender: true,
  frameCount: 0,
  lastFpsUpdate: 0,
  fpsUpdateInterval: 500,
}

const Shaders = {
  vertex: `#version 300 es
    in vec2 aPosition;
    out vec2 vUV;
    void main() {
      vUV = vec2(aPosition.x + 1.0, -aPosition.y + 1.0) * 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`,
  fragment: `#version 300 es
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
                r[i] = vec3(subPixelPos.x, subPixelPos.y, float(i) / float(NUM_REGISTERS)) + vec3(0.0, 0.0, uTime / 10.0);
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
            if (t == 0) { // PROJECTION
              float scalarProd = dot(src, ctrl);
              r[dr] = src * scalarProd;
            } else if (t == 1) { // SHIFT
              vec3 sum = src + ctrl;
              r[dr] = sum - step(vec3(1.0), sum);
            } else if (t == 2) { // SHIFTBACK
              vec3 diff = src - ctrl;
              r[dr] = diff + step(diff, vec3(0.0));
            } else if (t == 3) { // ROTATE
              r[dr] = vec3(src.y, src.z, src.x);
            } else if (t == 4) { // ROTATE2
              r[dr] = vec3(src.z, src.x, src.y);
            } else if (t == 5) { // MULTIPLY
              r[dr] = src * ctrl;
            } else if (t == 6) { // SINE
              r[dr] = vec3(0.5) + 0.5 * sin(20.0 * src * ctrl);
            } else if (t == 7) { // CONDITIONAL
              float sum = ctrl.x + ctrl.y + ctrl.z;
              r[dr] = (sum > 0.5) ? src : ctrl;
            } else if (t == 8) { // COMPLEMENT
              r[dr] = vec3(1.0) - src;
            }
          }
          accum += r[0];
        }
      }
      vec3 color = accum / float(OVERSAMPLING * OVERSAMPLING);
      outColor = vec4(color, 1.0);
    }`,
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) {
    console.error("Failed to create shader")
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram | null {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)

  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  if (!program) {
    console.error("Failed to create program")
    return null
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  return program
}

const Renderer = {
  init(canvas: OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
      depth: false,
      stencil: false,
    }) as WebGL2RenderingContext | null

    if (!gl) throw new Error("WebGL2 not available")
    console.log("[WebGL Canvas Create] Initialized WebGL2 context")

    RendererState.gl = gl
    this.initProgram()
    this.initGeometry()
    this.initUniforms()

    return gl
  },

  initProgram() {
    const gl = RendererState.gl
    if (!gl) throw new Error("WebGL context not initialized")

    const program = createProgram(gl, Shaders.vertex, Shaders.fragment)
    if (!program) throw new Error("Failed to create WebGL program")

    gl.useProgram(program)
    RendererState.program = program
  },

  initGeometry() {
    const gl = RendererState.gl
    const program = RendererState.program
    if (!gl || !program) throw new Error("Renderer not initialized")

    const quadVertices = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ])

    const vao = gl.createVertexArray()
    if (!vao) throw new Error("Failed to create vertex array")
    gl.bindVertexArray(vao)

    const positionBuffer = gl.createBuffer()
    if (!positionBuffer) throw new Error("Failed to create position buffer")
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)

    const posLoc = gl.getAttribLocation(program, "aPosition")
    if (posLoc === -1) throw new Error("Failed to get position attribute")
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    RendererState.vao = vao
    RendererState.positionBuffer = positionBuffer
  },

  initUniforms() {
    const gl = RendererState.gl
    const program = RendererState.program
    if (!gl || !program) throw new Error("Renderer not initialized")

    const uniforms = RendererState.uniforms

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

    if (uniforms.uTime) {
      gl.uniform1f(uniforms.uTime, 0.0)
    }
  },

  uploadFormula(formula: FormulaInfo) {
    const gl = RendererState.gl
    if (!gl) return

    console.log("[Shader Update] Uploading new formula to shaders")

    const { usedTransFlag, usedRegFlag } = optimize(formula)
    const uniforms = RendererState.uniforms

    if (uniforms.uTransformSequence) {
      gl.uniform1iv(
        uniforms.uTransformSequence,
        new Int32Array(formula.transformSequence)
      )
    }
    if (uniforms.uSource) {
      gl.uniform1iv(uniforms.uSource, new Int32Array(formula.source))
    }
    if (uniforms.uControl) {
      gl.uniform1iv(uniforms.uControl, new Int32Array(formula.control))
    }
    if (uniforms.uDest) {
      gl.uniform1iv(uniforms.uDest, new Int32Array(formula.dest))
    }
    if (uniforms.uUsedTransFlag) {
      gl.uniform1iv(
        uniforms.uUsedTransFlag,
        new Int32Array(usedTransFlag.map((flag) => (flag ? 1 : 0)))
      )
    }
    if (uniforms.uUsedRegFlag) {
      gl.uniform1iv(
        uniforms.uUsedRegFlag,
        new Int32Array(usedRegFlag.map((flag) => (flag ? 1 : 0)))
      )
    }

    RendererState.formula = formula
    RendererState.needsRender = true
    console.log("[Shader Update] Formula uploaded successfully")
  },

  render(time: number) {
    const gl = RendererState.gl
    const program = RendererState.program
    if (!gl || !program) return

    const { uniforms, renderMode } = RendererState

    if (renderMode.type === "animation" && uniforms.uTime) {
      const t = time * 0.001
      gl.uniform1f(uniforms.uTime, t)
    } else if (uniforms.uTime) {
      gl.uniform1f(uniforms.uTime, 0.0)
    }

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    if (renderMode.type === "animation") {
      RendererState.frameCount += 1
      const now = performance.now()
      if (now - RendererState.lastFpsUpdate >= RendererState.fpsUpdateInterval) {
        const fps =
          (RendererState.frameCount * 1000) /
          (now - RendererState.lastFpsUpdate)
        ctx.postMessage({ command: "fps", fps })
        RendererState.frameCount = 0
        RendererState.lastFpsUpdate = now
      }
    }

    if (renderMode.type === "export") {
      gl.finish()
      this.handleExport()
      return
    }

    ctx.postMessage({ command: "rendered", keepAlive: renderMode.keepAlive })

    if (renderMode.type === "animation") {
      requestAnimationFrame((nextTime) => this.render(nextTime))
    }
  },

  handleExport() {
    const gl = RendererState.gl
    if (!gl) return

    try {
      const canvas = gl.canvas as OffscreenCanvas
      canvas
        .convertToBlob()
        .then((blob) => {
          if (!blob) {
            this.fallbackExport(gl)
            return undefined
          }
          return createImageBitmap(blob)
        })
        .then((bitmap) => {
          if (!bitmap) return
          ctx.postMessage(
            {
              command: "rendered",
              keepAlive: false,
              kind: "bitmap",
              bitmap,
            } satisfies RenderedBitmapMessage,
            [bitmap]
          )
        })
        .catch((error) => {
          console.error("Error creating ImageBitmap:", error)
          this.fallbackExport(gl)
        })
    } catch (error) {
      console.error("Error in export:", error)
      ctx.postMessage({
        command: "error",
        message: "Failed to export canvas content",
      })
    }
  },

  fallbackExport(gl: WebGL2RenderingContext) {
    const width = gl.canvas.width
    const height = gl.canvas.height
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    ctx.postMessage(
      {
        command: "rendered",
        keepAlive: false,
        kind: "pixels",
        pixels: pixels.buffer,
        width,
        height,
      } satisfies RenderedPixelMessage,
      [pixels.buffer]
    )
  },

  cleanup() {
    const gl = RendererState.gl
    if (gl && RendererState.program) {
      const shaders = gl.getAttachedShaders(RendererState.program)
      if (shaders) {
        shaders.forEach((shader) => gl.deleteShader(shader))
      }
      gl.deleteProgram(RendererState.program)
    }

    if (gl && RendererState.vao) {
      gl.deleteVertexArray(RendererState.vao)
    }

    if (gl && RendererState.positionBuffer) {
      gl.deleteBuffer(RendererState.positionBuffer)
    }

    RendererState.gl = null
    RendererState.program = null
    RendererState.vao = null
    RendererState.positionBuffer = null
    RendererState.uniforms = createEmptyUniforms()
    RendererState.renderMode = { type: "interactive", keepAlive: false }
    RendererState.formula = null
    RendererState.needsRender = false
    RendererState.frameCount = 0
    RendererState.lastFpsUpdate = 0
  },
}

ctx.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const message = event.data

  try {
    switch (message.type) {
      case "cleanup":
        Renderer.cleanup()
        ctx.close()
        return

      case "update": {
        const gl = RendererState.gl
        if (!gl) return

        if (
          typeof message.width === "number" &&
          typeof message.height === "number"
        ) {
          gl.canvas.width = message.width
          gl.canvas.height = message.height
          const uniform = RendererState.uniforms.uResolution
          if (uniform) {
            gl.uniform2i(uniform, message.width, message.height)
          }
          gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
          gl.drawArrays(gl.TRIANGLES, 0, 6)
        }

        if (message.info) {
          Renderer.uploadFormula(message.info)
        }

        if (typeof message.keepAlive === "boolean") {
          RendererState.renderMode.keepAlive = message.keepAlive
          RendererState.renderMode.type = message.keepAlive
            ? "animation"
            : RendererState.renderMode.type === "animation"
            ? "interactive"
            : RendererState.renderMode.type
        }

        if (typeof message.isExport === "boolean" && !RendererState.renderMode.keepAlive) {
          RendererState.renderMode.type = message.isExport
            ? "export"
            : "interactive"
        }

        requestAnimationFrame((time) => Renderer.render(time))
        return
      }

      case "init": {
        const gl = Renderer.init(message.canvas)
        const renderType: RenderModeType = message.keepAlive
          ? "animation"
          : message.isExport
          ? "export"
          : "interactive"
        RendererState.renderMode = {
          type: renderType,
          keepAlive: message.keepAlive,
        }

        if (
          typeof message.width === "number" &&
          typeof message.height === "number"
        ) {
          gl.canvas.width = message.width
          gl.canvas.height = message.height
        }

        const resolutionUniform = RendererState.uniforms.uResolution
        if (resolutionUniform) {
          gl.uniform2i(resolutionUniform, gl.canvas.width, gl.canvas.height)
        }

        Renderer.uploadFormula(message.info)
        requestAnimationFrame((time) => Renderer.render(time))
        return
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error("Error in worker:", err)
    ctx.postMessage({
      command: "error",
      message: err.message || "Unknown error in worker",
    })
    Renderer.cleanup()
    ctx.close()
  }
})

export {}
