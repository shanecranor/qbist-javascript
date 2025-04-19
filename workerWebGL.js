// worker.js

// Global variables and context
let gl = null
let program = null
let mainFormula = null
let uResolutionLoc,
  uTimeLoc,
  uTransformSequenceLoc,
  uSourceLoc,
  uControlLoc,
  uDestLoc
let isSingleRender = false
let keepAlive = false

// Shader sources
const vertexShaderSource = `#version 300 es
    in vec2 aPosition;
    out vec2 vUV;
    void main() {
      vUV = aPosition * 0.5 + 0.5;
      // Flip Y coordinate by negating the y component
      gl_Position = vec4(aPosition.x, -aPosition.y, 0.0, 1.0);
    }`

const fragmentShaderSource = `#version 300 es
    precision highp float;
    precision highp int;
    in vec2 vUV;
    uniform ivec2 uResolution;
    uniform float uTime;
    uniform int uTransformSequence[36];
    uniform int uSource[36];
    uniform int uControl[36];
    uniform int uDest[36];
    out vec4 outColor;
    
    #define OVERSAMPLING 2
    const int MAX_TRANSFORMS = 36;
    const int NUM_REGISTERS = 6;
    
    void main() {
      vec2 pixelCoord = (vUV * vec2(uResolution));
      vec3 accum = vec3(0.0);
      int samples = OVERSAMPLING * OVERSAMPLING;
      for (int oy = 0; oy < OVERSAMPLING; oy++) {
        for (int ox = 0; ox < OVERSAMPLING; ox++) {
          vec2 subPixel = (pixelCoord * float(OVERSAMPLING) + vec2(float(ox), float(oy))) /
                          (vec2(uResolution) * float(OVERSAMPLING));
          vec3 r[NUM_REGISTERS];
          for (int i = 0; i < NUM_REGISTERS; i++) {
            r[i] = vec3(subPixel, float(i) / float(NUM_REGISTERS));
          }
          for (int i = 0; i < MAX_TRANSFORMS; i++) {
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
              vec3 diff = src - ctrl;
              r[dr] = diff + step(diff, vec3(0.0));
            } else if (t == 2) { // SHIFTBACK
              // step(edge, x) == 1.0 when x >= edge, else 0.0.
              // We want 1.0 exactly when diff <= 0.0, so swap args:
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
              float t   = step(1.5, sum);    // 0.0 if sum<1.5, 1.0 otherwise
              r[dr]     = mix(ctrl, src, t);  
            } else if (t == 8) { // COMPLEMENT
              r[dr] = vec3(1.0) - src;
            }
          }
          accum += r[0];
        }
      }
      vec3 color = accum / float(samples);
      outColor = vec4(color, 1.0);
    }`

// WebGL setup functions
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

function createProgram(gl, vsSource, fsSource) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource)
  const program = gl.createProgram()
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

// Formula generation functions
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min
}

function createInfo() {
  const info = {
    transformSequence: [],
    source: [],
    control: [],
    dest: [],
  }
  for (let k = 0; k < 36; k++) {
    info.transformSequence.push(randomInt(0, 9))
    info.source.push(randomInt(0, 6))
    info.control.push(randomInt(0, 6))
    info.dest.push(randomInt(0, 6))
  }
  return info
}

function uploadFormula(formula) {
  if (!gl || !program) return
  gl.uniform1iv(
    uTransformSequenceLoc,
    new Int32Array(formula.transformSequence)
  )
  gl.uniform1iv(uSourceLoc, new Int32Array(formula.source))
  gl.uniform1iv(uControlLoc, new Int32Array(formula.control))
  gl.uniform1iv(uDestLoc, new Int32Array(formula.dest))
}

function loadStateFromParam(stateBase64) {
  try {
    const stateJSON = atob(stateBase64)
    const stateObj = JSON.parse(stateJSON)
    if (
      stateObj.transformSequence &&
      stateObj.source &&
      stateObj.control &&
      stateObj.dest
    ) {
      return stateObj
    }
    console.error("Invalid pattern state")
    return null
  } catch (e) {
    console.error("Error loading state:", e)
    return null
  }
}

function render(time) {
  if (!gl || !program) return
  const t = time * 0.001
  gl.uniform1f(uTimeLoc, t)

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 6)

  if (isSingleRender && !keepAlive) {
    self.postMessage({ command: "rendered", keepAlive: false })
  } else {
    self.postMessage({ command: "rendered", keepAlive: true })
    requestAnimationFrame(render)
  }
}

// Message handler
self.addEventListener("message", (event) => {
  if (event.data.type === "update") {
    mainFormula = event.data.info
    uploadFormula(mainFormula)
    requestAnimationFrame(render)
    return
  }

  if (!event.data.canvas) {
    console.error("No canvas provided in the message.")
    return
  }

  const canvas = event.data.canvas
  gl = canvas.getContext("webgl2", { antialias: true })
  if (!gl) {
    console.error("WebGL2 is not available in this worker.")
    return
  }

  // Initialize WebGL
  program = createProgram(gl, vertexShaderSource, fragmentShaderSource)
  gl.useProgram(program)

  // Set up quad geometry
  const quadVertices = new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ])
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)
  const posLoc = gl.getAttribLocation(program, "aPosition")
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  // Get uniform locations
  uResolutionLoc = gl.getUniformLocation(program, "uResolution")
  uTimeLoc = gl.getUniformLocation(program, "uTime")
  uTransformSequenceLoc = gl.getUniformLocation(program, "uTransformSequence")
  uSourceLoc = gl.getUniformLocation(program, "uSource")
  uControlLoc = gl.getUniformLocation(program, "uControl")
  uDestLoc = gl.getUniformLocation(program, "uDest")

  gl.uniform2i(uResolutionLoc, canvas.width, canvas.height)

  // Initialize formula
  isSingleRender = event.data.type === "init" && event.data.info
  keepAlive = event.data.keepAlive

  if (isSingleRender) {
    mainFormula = event.data.info
  } else if (event.data.type === "init" && event.data.b64state) {
    mainFormula = loadStateFromParam(event.data.b64state)
    if (!mainFormula) return
  } else {
    mainFormula = createInfo()
  }

  uploadFormula(mainFormula)
  requestAnimationFrame(render)
})
