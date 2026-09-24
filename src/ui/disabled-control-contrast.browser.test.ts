import { afterEach, expect, test } from 'vitest'
import './tokens.css'

let fixture: HTMLDivElement
afterEach(() => fixture?.remove())

function rgb(value: string): number[] {
  return (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number)
}

function composite(foreground: number[], background: number[], opacity: number): number[] {
  return foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity))
}

function luminance(channels: number[]): number {
  const linear = channels.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function renderedContrast(button: HTMLButtonElement, backdrop: HTMLElement): number {
  const style = getComputedStyle(button)
  const backdropColor = rgb(getComputedStyle(backdrop).backgroundColor)
  const foreground = composite(rgb(style.color), backdropColor, Number(style.opacity))
  const background = composite(rgb(style.backgroundColor), backdropColor, Number(style.opacity))
  const brighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (brighter + 0.05) / (darker + 0.05)
}

test('disabled Upload, Mixer, and Export labels stay readable without looking enabled', () => {
  fixture = document.body.appendChild(document.createElement('div'))
  fixture.innerHTML = `
    <section class="upload-page">
      <button class="primary-action" disabled>Separate · Rock · 6 stems</button>
      <button class="primary-action">Separate · Rock · 6 stems</button>
    </section>
    <section class="mixer-transport"><div class="mixer-loop-controls">
      <button class="mixer-set-loop-b" disabled>Set B</button><button>Set B</button>
      <button class="mixer-clear-loop" disabled>Clear loop</button><button>Clear loop</button>
    </div></section>
    <section class="export-actions">
      <button class="export-download-zip" disabled>Download ZIP · 0 B</button>
      <button class="export-download-zip">Download ZIP · 1 MiB</button>
      <button disabled>Download selected</button><button>Download selected</button>
    </section>`

  const mixer = fixture.querySelector<HTMLElement>('.mixer-transport')!
  const exportBackdrop = document.documentElement
  for (const [selector, backdrop] of [
    ['.primary-action:disabled', document.documentElement],
    ['.mixer-set-loop-b:disabled', mixer],
    ['.mixer-clear-loop:disabled', mixer],
    ['.export-download-zip:disabled', exportBackdrop],
    ['.export-actions button:disabled:not(.export-download-zip)', exportBackdrop],
  ] as const) {
    const button = fixture.querySelector<HTMLButtonElement>(selector)!
    expect(renderedContrast(button, backdrop), selector).toBeGreaterThanOrEqual(4.5)
    expect(getComputedStyle(button).cursor).toBe('not-allowed')
    const enabled = button.nextElementSibling as HTMLButtonElement
    expect(getComputedStyle(button).backgroundColor).not.toBe(getComputedStyle(enabled).backgroundColor)
  }
})
