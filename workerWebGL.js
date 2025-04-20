// WebGL Worker for Qbist rendering
import { optimize } from "./qbist.js"

// WebGL Utility Functions
function createShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl, vertexSource, fragmentSource) {
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

// Renderer state management
const RendererState = {
  gl: null,
  program: null,
  vao: null,
  positionBuffer: null,
  uniforms: {
    uResolution: null,
    uTime: null,
    uTransformSequence: null,
    uSource: null,
    uControl: null,
    uDest: null,
    uUsedTransFlag: null,
    uUsedRegFlag: null,
  },
  renderMode: {
    type: "interactive", // 'interactive', 'export', or 'animation'
    keepAlive: false,
    refreshEveryFrame: false,
  },
  formula: null,
  lastRenderTime: 0, // Track last render time
  needsRender: true, // Track if render is needed
}

// Shader sources
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
              r[i] = vec3(subPixelPos.x, subPixelPos.y, float(i) / float(NUM_REGISTERS));
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
              r[dr] = (sum > 0.5) ? src : ctrl;  // Fixed to match JavaScript implementation
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

// Renderer setup and management
const Renderer = {
  init(canvas) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      preserveDrawingBuffer: true,
    })

    if (!gl) throw new Error("WebGL2 not available")

    RendererState.gl = gl
    this.initProgram()
    this.initGeometry()
    this.initUniforms()

    return gl
  },

  initProgram() {
    const gl = RendererState.gl
    const program = createProgram(gl, Shaders.vertex, Shaders.fragment)
    if (!program) throw new Error("Failed to create WebGL program")
    gl.useProgram(program)
    RendererState.program = program
  },

  initGeometry() {
    const gl = RendererState.gl
    const quadVertices = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ])

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)

    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)

    const posLoc = gl.getAttribLocation(RendererState.program, "aPosition")
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    RendererState.vao = vao
    RendererState.positionBuffer = positionBuffer
  },

  initUniforms() {
    const gl = RendererState.gl
    const program = RendererState.program

    // Cache all uniform locations
    const uniforms = RendererState.uniforms
    Object.keys(uniforms).forEach((name) => {
      uniforms[name] = gl.getUniformLocation(program, name)
    })
  },

  uploadFormula(formula) {
    const gl = RendererState.gl
    if (!gl || !RendererState.program) return

    console.log("[Shader Update] Uploading new formula to shaders")

    const { usedTransFlag, usedRegFlag } = optimize(formula)
    const uniforms = RendererState.uniforms

    gl.uniform1iv(
      uniforms.uTransformSequence,
      new Int32Array(formula.transformSequence)
    )
    gl.uniform1iv(uniforms.uSource, new Int32Array(formula.source))
    gl.uniform1iv(uniforms.uControl, new Int32Array(formula.control))
    gl.uniform1iv(uniforms.uDest, new Int32Array(formula.dest))
    gl.uniform1iv(
      uniforms.uUsedTransFlag,
      new Int32Array(usedTransFlag.map((f) => (f ? 1 : 0)))
    )
    gl.uniform1iv(
      uniforms.uUsedRegFlag,
      new Int32Array(usedRegFlag.map((f) => (f ? 1 : 0)))
    )

    // Mark that we need a new render
    RendererState.needsRender = true
    console.log("[Shader Update] Formula uploaded successfully")
  },

  render(time) {
    const { gl, uniforms, renderMode } = RendererState
    if (!gl || !RendererState.program) return

    // Only render if:
    // 1. We need to render (due to an update)
    // 2. Or if refreshEveryFrame is enabled
    if (!RendererState.needsRender && !renderMode.refreshEveryFrame) {
      if (renderMode.keepAlive) {
        requestAnimationFrame((t) => this.render(t))
      }
      return
    }

    if (RendererState.needsRender) {
      console.log("[Render] New frame triggered by formula update")
    } else if (renderMode.refreshEveryFrame) {
      console.log("[Render] New frame triggered by refreshEveryFrame")
    }

    const t = time * 0.001
    gl.uniform1f(uniforms.uTime, t)

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    RendererState.needsRender = false

    if (renderMode.type === "export") {
      this.handleExport()
    } else if (
      renderMode.type === "interactive" ||
      renderMode.type === "animation"
    ) {
      this.handleContinuousRender(time)
    }
  },

  handleExport() {
    const gl = RendererState.gl
    gl.finish()

    try {
      const bitmap = gl.canvas.transferToImageBitmap()
      self.postMessage(
        {
          command: "rendered",
          keepAlive: false,
          kind: "bitmap",
          bitmap,
        },
        [bitmap]
      )
    } catch (err) {
      console.error("Error transferring to ImageBitmap:", err)
      self.postMessage({
        command: "error",
        message: "Failed to transfer canvas to ImageBitmap",
      })
    }
  },

  handleContinuousRender(time) {
    self.postMessage({
      command: "rendered",
      keepAlive: RendererState.renderMode.keepAlive,
    })

    if (RendererState.renderMode.keepAlive) {
      requestAnimationFrame((t) => this.render(t))
    }
  },

  cleanup() {
    const { gl, program, vao, positionBuffer } = RendererState

    if (!gl) return

    if (program) {
      const shaders = gl.getAttachedShaders(program)
      if (shaders) {
        shaders.forEach((shader) => gl.deleteShader(shader))
      }
      gl.deleteProgram(program)
    }

    if (vao) gl.deleteVertexArray(vao)
    if (positionBuffer) gl.deleteBuffer(positionBuffer)

    Object.keys(RendererState).forEach((key) => {
      RendererState[key] = null
    })
  },
}

// Message handling
self.addEventListener("message", (event) => {
  try {
    const { type, canvas, info, keepAlive, refreshEveryFrame } = event.data

    if (type === "cleanup") {
      Renderer.cleanup()
      self.close()
      return
    }

    if (type === "update") {
      RendererState.formula = info
      RendererState.renderMode.refreshEveryFrame = refreshEveryFrame
      Renderer.uploadFormula(info)
      // Trigger a new render
      requestAnimationFrame((time) => Renderer.render(time))
      return
    }

    // Initialize new render context
    if (type === "init") {
      if (!canvas) throw new Error("No canvas provided")

      Renderer.init(canvas)
      RendererState.renderMode = {
        type: info ? "export" : "interactive",
        keepAlive: keepAlive || false,
        refreshEveryFrame: refreshEveryFrame || false,
      }

      const gl = RendererState.gl
      gl.uniform2i(
        RendererState.uniforms.uResolution,
        canvas.width,
        canvas.height
      )

      RendererState.formula = info
      Renderer.uploadFormula(info)
      requestAnimationFrame((time) => Renderer.render(time))
    }
  } catch (err) {
    console.error("Error in worker:", err)
    self.postMessage({
      command: "error",
      message: err.message || "Unknown error in worker",
    })
    Renderer.cleanup()
  }
})
