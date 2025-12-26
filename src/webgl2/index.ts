import { createInfo } from '../qbist.ts'
import { isFormulaInfo } from '../qbistListeners.ts'
import WebGlWorker from '../workerWebGL.ts?worker'

const urlParams = new URLSearchParams(window.location.search)
let info = createInfo() // Default pattern if no state provided

if (urlParams.has('state')) {
  try {
    const stateJSON = atob(urlParams.get('state') || '')
    const stateObj = JSON.parse(stateJSON)
    if (isFormulaInfo(stateObj)) {
      info = stateObj
    }
  } catch (e) {
    console.error('Error loading state:', e)
  }
}

const canvas = document.getElementById('canvas')
const fpsDisplay = document.getElementById('fps')
if (!(canvas instanceof HTMLCanvasElement) || !canvas)
  throw new Error('Canvas element not found or invalid')

if (!(fpsDisplay instanceof HTMLDivElement) || !fpsDisplay)
  throw new Error('FPS display element not found or invalid')

// Create and start the worker.
const worker = new WebGlWorker()

// Handle messages from worker including FPS updates
worker.onmessage = (e) => {
  if (e.data.command === 'fps') {
    console.log('FP2S:', e.data.fps)
    fpsDisplay.textContent = `FPS: ${e.data.fps.toFixed(1)}`
  }
  // Handle any other messages normally
}

// Initialize with the pattern info and animation enabled
const offscreen = canvas.transferControlToOffscreen()
worker.postMessage(
  {
    type: 'init',
    canvas: offscreen,
    width: window.innerWidth,
    height: window.innerHeight,
    info: info,
    keepAlive: true,
  },
  [offscreen],
)

// Handle window resize
window.addEventListener('resize', () => {
  const width = window.innerWidth
  const height = window.innerHeight
  worker.postMessage({
    type: 'update',
    width: width,
    height: height,
  })
})
