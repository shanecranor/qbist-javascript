// worker.js

// Listen for the canvas from the main thread.
self.addEventListener("message", (event) => {
  if (!event.data.canvas) {
    console.error("No canvas provided in the message.")
    return
  }
  const canvas = event.data.canvas
  const gl = canvas.getContext("webgl2")
  if (!gl) {
    console.error("WebGL2 is not available in this worker.")
    return
  }

  // --- Shader Sources ---

  // Vertex shader: simple pass-through that calculates UV coordinates.
  const vertexShaderSource = `#version 300 es
      in vec2 aPosition;
      out vec2 vUV;
      void main() {
        vUV = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`

  // Fragment shader: implements the Qbist algorithm with a uniform time value (uTime)
  // to animate the image. It uses fixed oversampling for anti-aliasing.
  const fragmentShaderSource = `#version 300 es
      precision highp float;
      precision highp int;
      in vec2 vUV;
      uniform ivec2 uResolution;
      uniform float uTime;
      // The formula arrays (each with 36 elements)
      uniform int uTransformSequence[36];
      uniform int uSource[36];
      uniform int uControl[36];
      uniform int uDest[36];
      out vec4 outColor;
      
      #define OVERSAMPLING 2
      const int MAX_TRANSFORMS = 36;
      const int NUM_REGISTERS = 6;
      
      void main() {
        vec2 pixelCoord = vUV * vec2(uResolution);
        vec3 accum = vec3(0.0);
        int samples = OVERSAMPLING * OVERSAMPLING;
        // Loop over subpixel samples for anti-aliasing.
        for (int oy = 0; oy < OVERSAMPLING; oy++) {
          for (int ox = 0; ox < OVERSAMPLING; ox++) {
            vec2 subPixel = (pixelCoord * float(OVERSAMPLING) + vec2(float(ox), float(oy))) /
                            (vec2(uResolution) * float(OVERSAMPLING));
            // Initialize registers with the subpixel coordinate and add a time offset.
            vec3 r[NUM_REGISTERS];
            for (int i = 0; i < NUM_REGISTERS; i++) {
              r[i] = (vec3(subPixel, float(i) / float(NUM_REGISTERS)) + vec3(0,0,uTime * 0.0)) * 1.0;
            }
            // Apply each of the 36 transformations.
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
                r[dr] = mod(src + ctrl, 1.0);
              } else if (t == 2) { // SHIFTBACK
                r[dr] = mod(src - ctrl, 1.0);
              } else if (t == 3) { // ROTATE
                r[dr] = vec3(src.y, src.z, src.x);
              } else if (t == 4) { // ROTATE2
                r[dr] = vec3(src.z, src.x, src.y);
              } else if (t == 5) { // MULTIPLY
                r[dr] = src * ctrl;
              } else if (t == 6) { // SINE
                r[dr] = vec3(0.5 + 0.5*sin(20.0*src.x*ctrl.x),
                             0.5 + 0.5*sin(20.0*src.y*ctrl.y),
                             0.5 + 0.5*sin(20.0*src.z*ctrl.z));
              } else if (t == 7) { // CONDITIONAL
                float sum = ctrl.x + ctrl.y + ctrl.z;
                r[dr] = sum > 0.5 ? src : ctrl;
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

  // --- Shader Compilation and Linking ---
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

  const program = createProgram(gl, vertexShaderSource, fragmentShaderSource)
  gl.useProgram(program)

  // --- Set Up Full-Screen Quad ---
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

  // --- Get Uniform Locations ---
  const uResolutionLoc = gl.getUniformLocation(program, "uResolution")
  const uTimeLoc = gl.getUniformLocation(program, "uTime")
  const uTransformSequenceLoc = gl.getUniformLocation(
    program,
    "uTransformSequence"
  )
  const uSourceLoc = gl.getUniformLocation(program, "uSource")
  const uControlLoc = gl.getUniformLocation(program, "uControl")
  const uDestLoc = gl.getUniformLocation(program, "uDest")

  gl.uniform2i(uResolutionLoc, canvas.width, canvas.height)

  // --- CPU Side: Formula Generation Functions ---
  const MAX_TRANSFORMS = 36
  const NUM_REGISTERS = 6
  const NUM_TRANSFORM_TYPES = 9 // 0..8

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
    for (let k = 0; k < MAX_TRANSFORMS; k++) {
      info.transformSequence.push(randomInt(0, NUM_TRANSFORM_TYPES))
      info.source.push(randomInt(0, NUM_REGISTERS))
      info.control.push(randomInt(0, NUM_REGISTERS))
      info.dest.push(randomInt(0, NUM_REGISTERS))
    }
    return info
  }

  function modifyInfo(oldInfo) {
    const newInfo = {
      transformSequence: oldInfo.transformSequence.slice(),
      source: oldInfo.source.slice(),
      control: oldInfo.control.slice(),
      dest: oldInfo.dest.slice(),
    }
    const n = randomInt(0, MAX_TRANSFORMS)
    for (let k = 0; k < n; k++) {
      switch (randomInt(0, 4)) {
        case 0:
          newInfo.transformSequence[randomInt(0, MAX_TRANSFORMS)] = randomInt(
            0,
            NUM_TRANSFORM_TYPES
          )
          break
        case 1:
          newInfo.source[randomInt(0, MAX_TRANSFORMS)] = randomInt(
            0,
            NUM_REGISTERS
          )
          break
        case 2:
          newInfo.control[randomInt(0, MAX_TRANSFORMS)] = randomInt(
            0,
            NUM_REGISTERS
          )
          break
        case 3:
          newInfo.dest[randomInt(0, MAX_TRANSFORMS)] = randomInt(
            0,
            NUM_REGISTERS
          )
          break
      }
    }
    return newInfo
  }

  // Global formula for the current animation.
  let mainFormula = createInfo()
  if (event.data.b64state) {
    const stateObj = loadStateFromParam(event.data.b64state)
    if (!stateObj) return
    mainFormula = stateObj
  }

  function uploadFormula(formula) {
    gl.uniform1iv(
      uTransformSequenceLoc,
      new Int32Array(formula.transformSequence)
    )
    gl.uniform1iv(uSourceLoc, new Int32Array(formula.source))
    gl.uniform1iv(uControlLoc, new Int32Array(formula.control))
    gl.uniform1iv(uDestLoc, new Int32Array(formula.dest))
  }
  uploadFormula(mainFormula)

  // --- Animation Loop ---
  let lastMutationTime = performance.now()
  function render(time) {
    const t = time * 0.001 // seconds
    gl.uniform1f(uTimeLoc, t)

    // Mutate the formula every 5 seconds.
    // if (time - lastMutationTime > 5000) {
    //   mainFormula = modifyInfo(mainFormula)
    //   uploadFormula(mainFormula)
    //   lastMutationTime = time
    // }

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    requestAnimationFrame(render)
  }
  requestAnimationFrame(render)
})

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
    } else {
      alert("Invalid pattern state")
    }
  } catch (e) {
    console.error("Error loading state:", e)
    alert("Error loading pattern state")
  }
}
