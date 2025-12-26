import { createInfo, isFormulaInfo, type FormulaInfo } from './qbist.ts'
import { QbistRenderer } from './QbistRenderer.ts'

interface ResolutionConfig {
  label: string
  width: number
  height: number
}

interface BenchmarkStats {
  average: number
  min: number
  max: number
}

const resolutions: ResolutionConfig[] = [
  { label: '256 × 256', width: 256, height: 256 },
  { label: '512 × 512', width: 512, height: 512 },
  { label: '1024 × 1024', width: 1024, height: 1024 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '3840 × 2160', width: 3840, height: 2160 },
]

const iterationsPerResolution = 10

function requireElement<T extends Element>(
  id: string,
  ctor: { new (...args: unknown[]): T },
): T {
  const element = document.getElementById(id)
  if (!(element instanceof ctor)) {
    throw new Error(`Expected ${id} to be a ${ctor.name}`)
  }
  return element
}

const runButton = requireElement('runBenchmark', HTMLButtonElement)
const statusLabel = requireElement('status', HTMLElement)
const resultsBody = requireElement('resultsBody', HTMLTableSectionElement)

function loadFormulaFromUrl(): FormulaInfo {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('state')) {
    return createInfo()
  }

  try {
    const encoded = params.get('state') ?? ''
    const decoded = atob(encoded)
    const parsed = JSON.parse(decoded)
    if (isFormulaInfo(parsed)) {
      return parsed
    }
  } catch (error) {
    console.warn(
      'Failed to parse state param, falling back to random formula',
      error,
    )
  }
  return createInfo()
}

function clearResultsTable() {
  resultsBody.innerHTML = ''
}

function appendRow(resolution: ResolutionConfig, stats: BenchmarkStats) {
  const row = document.createElement('tr')
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  row.innerHTML = [
    `<td>${resolution.label}</td>`,
    `<td>${formatter.format(stats.average)}</td>`,
    `<td>${formatter.format(stats.min)}</td>`,
    `<td>${formatter.format(stats.max)}</td>`,
  ].join('')

  resultsBody.appendChild(row)
}

function computeStats(samples: number[]): BenchmarkStats {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  return {
    average: sum / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }
}

async function benchmarkResolution(
  resolution: ResolutionConfig,
  formula: FormulaInfo,
): Promise<BenchmarkStats> {
  const canvas = document.createElement('canvas')
  canvas.width = resolution.width
  canvas.height = resolution.height
  canvas.classList.add('hidden-canvas')
  document.body.appendChild(canvas)

  const renderer = new QbistRenderer(canvas)
  const samples: number[] = []

  // Warm up once to compile pipelines and allocate buffers.
  await renderer.render(formula, { keepAlive: false })

  for (let iteration = 0; iteration < iterationsPerResolution; iteration++) {
    const start = performance.now()
    await renderer.render(formula, { keepAlive: false })
    samples.push(performance.now() - start)
  }

  renderer.cleanup()
  canvas.remove()

  return computeStats(samples)
}

async function runBenchmark() {
  runButton.disabled = true
  statusLabel.textContent = 'Preparing worker...'
  clearResultsTable()

  try {
    await QbistRenderer.ensureWorkerResponsive()
  } catch (error) {
    statusLabel.textContent = 'Worker failed to respond.'
    console.error(error)
    runButton.disabled = false
    return
  }

  const formula = loadFormulaFromUrl()

  for (const resolution of resolutions) {
    statusLabel.textContent = `Running ${resolution.label} (${iterationsPerResolution} samples)`
    const stats = await benchmarkResolution(resolution, formula)
    appendRow(resolution, stats)
  }

  statusLabel.textContent = 'Benchmark complete.'
  runButton.disabled = false
}

runButton.addEventListener('click', () => {
  void runBenchmark()
})
