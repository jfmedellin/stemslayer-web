import { afterEach, expect, test } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { page, userEvent } from 'vitest/browser'
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

test('engine and storage use visible labels instead of prohibited labels on generic elements', () => {
  render('upload', () => undefined)
  expect(document.querySelector('.engine-pill')?.hasAttribute('aria-label')).toBe(false)
  expect(document.querySelector('.storage-meter')?.hasAttribute('aria-label')).toBe(false)
  expect(document.querySelector('.engine-pill')?.textContent).toBe('WebGPU')
  expect(document.querySelector('.storage-meter')?.textContent).toMatch(/Browser storage/)
})

test('the shared desktop shell presents a compact brand, destination markers, and real free space', () => {
  render('upload', () => undefined)
  expect(document.querySelector('.brand-badge')?.textContent).toBe('STUDIO')
  expect(document.querySelector('.nav-heading')?.textContent).toBe('Workspace')
  expect(document.querySelectorAll('.nav-item').length).toBe(4)
  for (const item of document.querySelectorAll('.nav-item')) {
    expect(getComputedStyle(item, '::before').content).not.toBe('none')
  }
  expect(document.querySelector('.storage-meter-value')?.textContent).toMatch(/1\.9 GiB free/)
  expect(document.querySelector('.storage-meter')?.textContent).not.toMatch(/used|total/i)
})

test('decorative destination markers do not alter each navigation button name', () => {
  render('upload', () => undefined)
  for (const label of ['Upload', 'Library', 'Mixer', 'Export']) {
    expect(document.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
  }
})

test('renders the page content passed as children', () => {
  render('upload', () => undefined)
  expect(document.querySelector('main')?.textContent).toContain('page content')
})

test('keyboard traversal follows the sidebar order and exposes a visible focus indicator', async () => {
  await page.viewport(1280, 900)
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

test('desktop navigation can be collapsed and restored from the header', async () => {
  await page.viewport(1280, 900)
  render('upload', () => undefined)

  const toggle = document.querySelector<HTMLButtonElement>('[data-testid="nav-toggle"]')
  const navigation = document.querySelector<HTMLElement>('#app-nav')
  expect(toggle?.getAttribute('aria-expanded')).toBe('true')
  expect(navigation?.hidden).toBe(false)

  await userEvent.click(toggle!)
  expect(toggle?.getAttribute('aria-expanded')).toBe('false')
  expect(navigation?.hidden).toBe(true)
  expect(document.querySelector('.workspace')?.getBoundingClientRect().left).toBe(0)

  await userEvent.click(toggle!)
  expect(toggle?.getAttribute('aria-expanded')).toBe('true')
  expect(navigation?.hidden).toBe(false)
})

test('sidebar toggle sits beside the brand on the left and uses an outlined panel icon', async () => {
  await page.viewport(1280, 900)
  render('upload', () => undefined)

  const header = document.querySelector<HTMLElement>('.app-header')!
  const controls = document.querySelector<HTMLElement>('.brand-controls')
  const brand = document.querySelector<HTMLElement>('.brand-lockup')!
  const engine = document.querySelector<HTMLElement>('.engine-pill')!
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid="nav-toggle"]')!
  const icon = toggle.querySelector('svg')

  expect(controls).not.toBeNull()
  expect(controls?.contains(brand)).toBe(true)
  expect(controls?.firstElementChild).toBe(toggle)
  expect(controls?.lastElementChild).toBe(brand)
  expect(controls?.getBoundingClientRect().left).toBeCloseTo(
    header.getBoundingClientRect().left + parseFloat(getComputedStyle(header).paddingLeft),
    0,
  )
  expect(toggle.getBoundingClientRect().right).toBeLessThan(brand.getBoundingClientRect().left)
  expect(brand.getBoundingClientRect().left - toggle.getBoundingClientRect().right).toBeLessThanOrEqual(12)
  expect(engine.getBoundingClientRect().left).toBeGreaterThan(toggle.getBoundingClientRect().right)
  expect(engine.getBoundingClientRect().right).toBeCloseTo(
    header.getBoundingClientRect().right - parseFloat(getComputedStyle(header).paddingRight),
    0,
  )
  expect(icon).not.toBeNull()
  expect(icon?.getAttribute('viewBox')).toBe('0 0 24 24')
  expect(icon?.getAttribute('aria-hidden')).toBe('true')
  expect(toggle.textContent).not.toContain('☰')
})

test('narrow screens start with navigation hidden and open it as a dismissible drawer', async () => {
  await page.viewport(390, 844)
  render('upload', () => undefined)

  const toggle = document.querySelector<HTMLButtonElement>('[data-testid="nav-toggle"]')
  const navigation = document.querySelector<HTMLElement>('#app-nav')
  expect(toggle?.getAttribute('aria-expanded')).toBe('false')
  expect(navigation?.hidden).toBe(true)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)

  await userEvent.click(toggle!)
  expect(navigation?.hidden).toBe(false)
  expect(document.querySelector('[data-testid="nav-backdrop"]')).not.toBeNull()

  await userEvent.click(document.querySelector('[data-testid="nav-backdrop"]')!)
  expect(navigation?.hidden).toBe(true)

  await userEvent.click(toggle!)
  await userEvent.keyboard('{Escape}')
  expect(navigation?.hidden).toBe(true)
})

test('choosing a destination closes the narrow-screen drawer and keeps navigation accessible', async () => {
  await page.viewport(390, 844)
  let navigatedTo: string | undefined
  render('upload', (destination) => { navigatedTo = destination })
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid="nav-toggle"]')

  await userEvent.click(toggle!)
  const mixer = document.querySelector<HTMLButtonElement>('[data-destination="mixer"]')
  await userEvent.click(mixer!)

  expect(navigatedTo).toBe('mixer')
  expect(document.querySelector<HTMLElement>('#app-nav')?.hidden).toBe(true)
})
