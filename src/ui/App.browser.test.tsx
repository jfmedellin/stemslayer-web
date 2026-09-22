import { afterEach, expect, test } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App.tsx'
import { FakeHash } from '../../tests/fakes/fake-hash'
import { FakeLock } from '../../tests/fakes/fake-lock'
import { FakeQuota } from '../../tests/fakes/fake-quota'
import { InMemoryCatalog } from '../../tests/fakes/in-memory-catalog'
import { InMemoryModelStore } from '../../tests/fakes/in-memory-model-store'

let root: Root
afterEach(() => root.unmount())

function renderApp() {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(<App dependencies={{
    addToLibraryDeps: {
      catalog: new InMemoryCatalog(),
      modelStore: new InMemoryModelStore(),
      quota: new FakeQuota(5_000_000_000),
      lock: new FakeLock(),
      hash: new FakeHash(),
      generateTrackId: () => `track-${Math.random()}`,
      now: () => '2026-09-22T00:00:00.000Z',
    },
    navigatorRef: { gpu: undefined },
  }} />))
}

test('renders the real four-destination shell with the Upload page active by default', () => {
  renderApp()
  expect([...document.querySelectorAll('.nav-item')].map((el) => el.textContent))
    .toEqual(['Upload', 'Library', 'Mixer', 'Export'])
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Upload')
  expect(document.querySelector('.drop-zone')).not.toBeNull()
  expect(document.querySelector('.engine-pill')?.textContent).toBe('WASM')
})

test('navigating to Library renders a placeholder destination without any mixer/export wiring', async () => {
  renderApp()
  const libraryItem = [...document.querySelectorAll('.nav-item')].find((el) => el.textContent === 'Library')
  flushSync(() => (libraryItem as HTMLButtonElement).click())
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Library')
  expect(document.querySelector('.drop-zone')).toBeNull()
})
