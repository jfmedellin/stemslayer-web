import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const configPath = fileURLToPath(new URL('../vercel.json', import.meta.url))

interface HeaderEntry {
  readonly key: string
  readonly value: string
}

describe('Vercel security header configuration', () => {
  test('applies the required restrictive browser policy to every route', async () => {
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      readonly headers: readonly {
        readonly source: string
        readonly headers: readonly HeaderEntry[]
      }[]
    }

    expect(config.headers).toHaveLength(1)
    expect(config.headers[0].source).toBe('/(.*)')
    const headers = new Map(config.headers[0].headers.map(({ key, value }) => [key.toLowerCase(), value]))
    const csp = headers.get('content-security-policy')

    expect(csp).toBeDefined()
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('permissions-policy')).toBe('camera=(), geolocation=(), microphone=()')

    const directives = new Map((csp ?? '').split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name, values]
    }))

    expect(directives.get('default-src')).toEqual(["'none'"])
    expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(directives.get('worker-src')).toEqual(["'self'"])
    expect(directives.get('connect-src')).toEqual([
      "'self'",
      'https://huggingface.co',
      'https://us.aws.cdn.hf.co',
    ])
    expect(directives.get('base-uri')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
    expect(directives.get('form-action')).toEqual(["'self'"])
    expect(directives.get('script-src')).not.toContain("'unsafe-eval'")
    expect(csp).not.toContain('*')
    expect(headers.has('cross-origin-opener-policy')).toBe(false)
    expect(headers.has('cross-origin-embedder-policy')).toBe(false)
  })
})
