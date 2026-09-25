/* global URL, console, setTimeout, clearTimeout, fetch, document, window, WebAssembly, Worker, AudioContext, AudioWorkletNode */

// Local-only approximation: Vercel's checked-in route config is applied by this
// test server; this does not observe response headers from a deployed Vercel site.
// style-src permits inline style attributes because React sets dynamic timeline,
// gain, and playhead positions; wasm-unsafe-eval enables model WASM compilation
// without allowing general eval. Every browser request outside this local origin
// is aborted so this harness cannot fetch model weights or other remote resources.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const dist = new URL('../dist/', import.meta.url)
const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
const configuredHeaders = config.headers.find(({ source }) => source === '/(.*)')?.headers
assert.ok(configuredHeaders, 'vercel.json must define its global response-header rule')
const responseHeaders = Object.fromEntries(configuredHeaders.map(({ key, value }) => [key.toLowerCase(), value]))
const assets = await readdir(new URL('assets/', dist))
const workletAsset = assets.find((name) => /^mixer-processor-.*\.js$/.test(name))
const jsAsset = assets.find((name) => name.endsWith('.js'))
const cssAsset = assets.find((name) => name.endsWith('.css'))
assert.ok(workletAsset, 'the production build must emit the JavaScript AudioWorklet asset')
assert.ok(jsAsset, 'the production build must emit JavaScript assets')
assert.ok(cssAsset, 'the production build must emit a CSS asset')

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
])
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname === '/probe-worker.js') {
    response.writeHead(200, { ...responseHeaders, 'content-type': 'text/javascript; charset=utf-8' })
    response.end("self.postMessage('same-origin-worker-ok')")
    return
  }

  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const file = new URL(relativePath, dist)
  if (!file.pathname.startsWith(new URL('../dist/', import.meta.url).pathname)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  try {
    const body = await readFile(file)
    const extension = relativePath.slice(relativePath.lastIndexOf('.'))
    response.writeHead(200, {
      ...responseHeaders,
      'content-type': contentTypes.get(extension) ?? 'application/octet-stream',
    })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
const origin = `http://127.0.0.1:${address.port}`
let browser

try {
  const htmlResponse = await fetch(origin)
  assert.equal(htmlResponse.status, 200, 'the local config-aware server should serve built HTML')
  const assetResponses = await Promise.all([jsAsset, cssAsset, workletAsset].map((asset) => fetch(`${origin}/assets/${asset}`)))
  for (const [index, response] of assetResponses.entries()) {
    assert.equal(response.status, 200, `built asset ${[jsAsset, cssAsset, workletAsset][index]} should be served`)
  }

  for (const response of [htmlResponse, ...assetResponses]) {
    for (const [key, value] of Object.entries(responseHeaders)) {
      assert.equal(response.headers.get(key), value, `served response should include ${key}`)
    }
  }

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('**/*', (route) => {
    const requested = new URL(route.request().url())
    return requested.origin === origin ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  const policyViolations = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/.test(message.text())) return
  })
  await page.goto(origin)

  const policyResult = await page.evaluate(async ({ probeOrigin, workletAsset: emittedWorkletAsset }) => {
    const violations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push({ directive: event.violatedDirective, blockedURI: event.blockedURI })
    })

    const inlineScript = document.createElement('script')
    inlineScript.textContent = 'window.__forbiddenInlineScriptRan = true'
    document.head.append(inlineScript)

    let connectBlocked = false
    try {
      await fetch(`${probeOrigin}/forbidden-connect-probe`)
    } catch {
      connectBlocked = true
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
    const wasm = await WebAssembly.instantiate(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]))
    const workerResult = await new Promise((resolve, reject) => {
      const worker = new Worker('/probe-worker.js', { type: 'module' })
      const timeout = setTimeout(() => reject(new Error('same-origin module Worker did not reply')), 2000)
      worker.onmessage = ({ data }) => {
        clearTimeout(timeout)
        worker.terminate()
        resolve(data)
      }
      worker.onerror = (event) => {
        clearTimeout(timeout)
        worker.terminate()
        reject(new Error(event.message))
      }
    })

    const audio = new AudioContext()
    await audio.audioWorklet.addModule(`/assets/${emittedWorkletAsset}`)
    const worklet = new AudioWorkletNode(audio, 'stemslayer-mixer', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    worklet.disconnect()
    await audio.close()

    return {
      violations,
      connectBlocked,
      inlineScriptRan: window.__forbiddenInlineScriptRan === true,
      wasmReady: wasm.instance instanceof WebAssembly.Instance,
      workerResult,
    }
  }, {
    probeOrigin: `http://127.0.0.1:${address.port + 1}`,
    workletAsset,
  })

  assert.equal(policyResult.inlineScriptRan, false, 'CSP should block a synthetic inline script')
  assert.equal(policyResult.connectBlocked, true, 'CSP should block a synthetic off-origin fetch')
  assert.ok(policyResult.violations.some(({ directive }) => directive.startsWith('script-src')), 'inline script block should emit a CSP violation')
  assert.ok(policyResult.violations.some(({ directive }) => directive.startsWith('connect-src')), 'off-origin fetch block should emit a CSP violation')
  assert.equal(policyResult.wasmReady, true, 'CSP should permit single-threaded WebAssembly compilation')
  assert.equal(policyResult.workerResult, 'same-origin-worker-ok', 'CSP should permit a same-origin module Worker')
  policyViolations.push(...policyResult.violations)

  console.log(`PASS vercel-headers-smoke: config-aware local server applied ${Object.keys(responseHeaders).length} headers to built HTML and JS/CSS/AudioWorklet assets; CSP allowed same-origin Worker, AudioWorklet, and WASM, blocked inline script and off-origin connect (${policyViolations.length} violations).`)
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
