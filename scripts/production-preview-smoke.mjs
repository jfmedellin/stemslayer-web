/* global URL, process, fetch, AudioContext, AudioWorkletNode, console, setTimeout, clearTimeout */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const port = 4173
const origin = `http://127.0.0.1:${port}`
const workletAsset = (await readdir(new URL('../dist/assets/', import.meta.url)))
  .find((name) => /^mixer-processor-.*\.(?:js|ts)$/.test(name))

assert.ok(workletAsset, 'the production build must emit a mixer processor asset')

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
})
const previewExited = new Promise((resolve) => preview.once('exit', resolve))
let browser

try {
  let response
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      response = await fetch(origin)
      break
    } catch {
      await delay(100)
    }
  }
  assert.ok(response?.ok, 'Vite production preview should serve the built app')

  const assetResponse = await fetch(`${origin}/assets/${workletAsset}`)
  assert.equal(assetResponse.status, 200, 'production preview should serve the emitted worklet')
  assert.match(assetResponse.headers.get('content-type') ?? '', /javascript/, 'worklet must have a JavaScript MIME type')
  const source = await assetResponse.text()
  assert.doesNotMatch(source, /\b(?:interface|type)\s+\w+|:\s*(?:number|string|boolean)\b/, 'worklet asset must not contain raw TypeScript')

  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage()
  await page.goto(origin)
  const playback = await page.evaluate(async (url) => {
    const frameCount = 48000
    const context = new AudioContext({ sampleRate: 48000 })
    await context.resume()
    await context.audioWorklet.addModule(url)

    const node = new AudioWorkletNode(context, 'stemslayer-mixer', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    node.connect(analyser)
    analyser.connect(context.destination)
    const progress = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worklet did not report playback progress')), 2000)
      node.port.onmessage = (event) => {
        if (event.data.kind === 'progress' && event.data.isPlaying) {
          clearTimeout(timeout)
          resolve()
        }
      }
    })
    const left = new Float32Array(frameCount).fill(0.25)
    const right = new Float32Array(frameCount).fill(0.25)
    node.port.postMessage({
      kind: 'load',
      sampleRate: 48000,
      frameCount: left.length,
      lanes: [{ laneId: 'known-sample', displayName: 'Known sample', channels: [left, right], absent: false }],
    })
    node.port.postMessage({ kind: 'play' })
    await progress
    await new Promise((resolve) => setTimeout(resolve, 100))
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    const peak = Math.max(...samples.map(Math.abs))
    node.disconnect()
    analyser.disconnect()
    await context.close()
    return peak
  }, `/assets/${workletAsset}`)

  assert.ok(playback > 0.2, `known stem samples should reach the audio output (peak=${playback})`)
  console.log(`PASS production-preview-smoke: ${workletAsset}, JavaScript MIME, module load, sample playback peak=${playback.toFixed(3)}`)
} finally {
  await browser?.close()
  preview.kill()
  await previewExited
}
