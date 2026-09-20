import { afterEach, expect, test } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App.tsx'

let root: Root
afterEach(() => root.unmount())

test('renders the accessible empty shell', async () => {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(<App />))
  expect(document.querySelector('main')?.getAttribute('aria-labelledby')).toBe('workspace-title')
  expect(document.querySelector('h1')?.textContent).toBe('Your workspace is ready.')
})
