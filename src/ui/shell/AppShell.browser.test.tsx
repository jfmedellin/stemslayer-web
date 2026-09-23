import { afterEach, expect, test } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { userEvent } from 'vitest/browser'
import '../tokens.css'
import { AppShell } from './AppShell'

let root: Root
afterEach(() => root.unmount())

function render(activeDestination: 'upload' | 'library' | 'mixer' | 'export', onNavigate: (d: string) => void) {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(
    <AppShell
      activeDestination={activeDestination}
      onNavigate={onNavigate}
      engineProvider="webgpu"
      availableBytes={2_000_000_000}
    >
      <p>page content</p>
    </AppShell>,
  ))
}

test('renders all four nav destinations with the active one marked current', () => {
  render('library', () => undefined)
  const items = [...document.querySelectorAll('.nav-item')].map((el) => el.textContent)
  expect(items).toEqual(['Upload', 'Library', 'Mixer', 'Export'])
  const current = document.querySelector('[aria-current="page"]')
  expect(current?.textContent).toBe('Library')
})

test('clicking a nav destination reports it through onNavigate', () => {
  let navigatedTo: string | undefined
  render('upload', (destination) => { navigatedTo = destination })
  const mixerItem = [...document.querySelectorAll('.nav-item')].find((el) => el.textContent === 'Mixer')
  ;(mixerItem as HTMLButtonElement).click()
  expect(navigatedTo).toBe('mixer')
})

test('shows the WebGPU/WASM engine pill and a storage meter reading', () => {
  render('upload', () => undefined)
  expect(document.querySelector('.engine-pill')?.textContent).toBe('WebGPU')
  expect(document.querySelector('.storage-meter')?.textContent).toMatch(/1\.9 GiB/)
})

test('renders the page content passed as children', () => {
  render('upload', () => undefined)
  expect(document.querySelector('main')?.textContent).toContain('page content')
})

test('keyboard traversal follows the sidebar order and exposes a visible focus indicator', async () => {
  render('upload', () => undefined)
  const items = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')]

  items[0].focus()
  for (const [index, item] of items.entries()) {
    if (index > 0) await userEvent.tab()
    expect(document.activeElement).toBe(item)
    const style = getComputedStyle(item)
    expect(style.outlineStyle).not.toBe('none')
    expect(parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2)
  }
})
