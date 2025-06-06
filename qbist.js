// --- Core Constants and Transformation Types ---
const MAX_TRANSFORMS = 36
const NUM_REGISTERS = 6
const TransformType = {
  PROJECTION: 0,
  SHIFT: 1,
  SHIFTBACK: 2,
  ROTATE: 3,
  ROTATE2: 4,
  MULTIPLY: 5,
  SINE: 6,
  CONDITIONAL: 7,
  COMPLEMENT: 8,
}
const NUM_TRANSFORM_TYPES = 9 // Total transformation types

// --- Utility Functions ---
// Returns a random integer in [min, max)
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min
}

// --- Formula Generation ---
// Creates a random transformation formula (similar to ExpInfo in C)
export function createInfo() {
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

// Modify an existing formula by making random changes.
export function modifyInfo(oldInfo) {
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
        newInfo.dest[randomInt(0, MAX_TRANSFORMS)] = randomInt(0, NUM_REGISTERS)
        break
    }
  }
  return newInfo
}

// --- Optimization ---
// Determines which transformations and registers are actually used.
export function optimize(info) {
  const usedTransFlag = new Array(MAX_TRANSFORMS).fill(false)
  const usedRegFlag = new Array(NUM_REGISTERS).fill(false)
  for (let i = 0; i < MAX_TRANSFORMS; i++) {
    if (
      info.transformSequence[i] === TransformType.ROTATE ||
      info.transformSequence[i] === TransformType.ROTATE2 ||
      info.transformSequence[i] === TransformType.COMPLEMENT
    ) {
      info.control[i] = info.dest[i]
    }
  }
  function checkLastModified(p, n) {
    p--
    while (p >= 0 && info.dest[p] !== n) {
      p--
    }
    if (p < 0) {
      usedRegFlag[n] = true
    } else {
      usedTransFlag[p] = true
      checkLastModified(p, info.source[p])
      checkLastModified(p, info.control[p])
    }
  }
  checkLastModified(MAX_TRANSFORMS, 0)
  return { usedTransFlag, usedRegFlag }
}

// --- Core Image Processing (qbist) ---
// Process one pixel using the qbist algorithm.
export function qbist(
  info,
  x,
  y,
  width,
  height,
  oversampling,
  usedTransFlag,
  usedRegFlag
) {
  const accum = [0, 0, 0]
  for (let yy = 0; yy < oversampling; yy++) {
    for (let xx = 0; xx < oversampling; xx++) {
      const reg = new Array(NUM_REGISTERS)
      for (let i = 0; i < NUM_REGISTERS; i++) {
        if (usedRegFlag[i]) {
          reg[i] = [
            (x * oversampling + xx) / (width * oversampling),
            (y * oversampling + yy) / (height * oversampling),
            i / NUM_REGISTERS,
          ]
        } else {
          reg[i] = [0, 0, 0]
        }
      }
      for (let i = 0; i < MAX_TRANSFORMS; i++) {
        if (!usedTransFlag[i]) continue
        const sr = info.source[i]
        const cr = info.control[i]
        const dr = info.dest[i]
        switch (info.transformSequence[i]) {
          case TransformType.PROJECTION: {
            const scalarProd =
              reg[sr][0] * reg[cr][0] +
              reg[sr][1] * reg[cr][1] +
              reg[sr][2] * reg[cr][2]
            reg[dr] = [
              scalarProd * reg[sr][0],
              scalarProd * reg[sr][1],
              scalarProd * reg[sr][2],
            ]
            break
          }
          case TransformType.SHIFT: {
            let newVal = [
              reg[sr][0] + reg[cr][0],
              reg[sr][1] + reg[cr][1],
              reg[sr][2] + reg[cr][2],
            ]
            newVal = newVal.map((v) => (v >= 1.0 ? v - 1.0 : v))
            reg[dr] = newVal
            break
          }
          case TransformType.SHIFTBACK: {
            let newVal = [
              reg[sr][0] - reg[cr][0],
              reg[sr][1] - reg[cr][1],
              reg[sr][2] - reg[cr][2],
            ]
            newVal = newVal.map((v) => (v <= 0.0 ? v + 1.0 : v))
            reg[dr] = newVal
            break
          }
          case TransformType.ROTATE:
            reg[dr] = [reg[sr][1], reg[sr][2], reg[sr][0]]
            break
          case TransformType.ROTATE2:
            reg[dr] = [reg[sr][2], reg[sr][0], reg[sr][1]]
            break
          case TransformType.MULTIPLY:
            reg[dr] = [
              reg[sr][0] * reg[cr][0],
              reg[sr][1] * reg[cr][1],
              reg[sr][2] * reg[cr][2],
            ]
            break
          case TransformType.SINE:
            reg[dr] = [
              0.5 + 0.5 * Math.sin(20.0 * reg[sr][0] * reg[cr][0]),
              0.5 + 0.5 * Math.sin(20.0 * reg[sr][1] * reg[cr][1]),
              0.5 + 0.5 * Math.sin(20.0 * reg[sr][2] * reg[cr][2]),
            ]
            break
          case TransformType.CONDITIONAL: {
            const sum = reg[cr][0] + reg[cr][1] + reg[cr][2]
            reg[dr] = sum > 0.5 ? [...reg[sr]] : [...reg[cr]]
            break
          }
          case TransformType.COMPLEMENT:
            reg[dr] = [1.0 - reg[sr][0], 1.0 - reg[sr][1], 1.0 - reg[sr][2]]
            break
        }
      }
      accum[0] += reg[0][0]
      accum[1] += reg[0][1]
      accum[2] += reg[0][2]
    }
  }
  const samples = oversampling * oversampling
  return [accum[0] / samples, accum[1] / samples, accum[2] / samples]
}

// // Draw the pattern on a given canvas using a specific formula.
// function drawQbist(canvas, info, oversampling = 0) {
//   const ctx = canvas.getContext("2d")
//   const width = canvas.width
//   const height = canvas.height
//   const imageData = ctx.createImageData(width, height)
//   const data = imageData.data
//   const { usedTransFlag, usedRegFlag } = optimize(info)
//   for (let y = 0; y < height; y++) {
//     for (let x = 0; x < width; x++) {
//       const color = qbist(
//         info,
//         x,
//         y,
//         width,
//         height,
//         oversampling,
//         usedTransFlag,
//         usedRegFlag
//       )
//       const r = Math.floor(color[0] * 255)
//       const g = Math.floor(color[1] * 255)
//       const b = Math.floor(color[2] * 255)
//       const idx = (y * width + x) * 4
//       data[idx] = r
//       data[idx + 1] = g
//       data[idx + 2] = b
//       data[idx + 3] = 255
//     }
//   }
//   ctx.putImageData(imageData, 0, 0)
// }
