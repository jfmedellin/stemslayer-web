import type { BrowserCommand } from 'vitest/node'

interface CapturedRequest {
  readonly url: string
  readonly method: string
  readonly bodyHex: string | null
}

const requestsByTest = new Map<string, CapturedRequest[]>()

export const startPrivacyNetworkCapture: BrowserCommand = async (context) => {
  const requests: CapturedRequest[] = []
  requestsByTest.set(context.testPath ?? 'unknown', requests)

  await context.page.route('**/*', async (route) => {
    const request = route.request()
    const body = request.postDataBuffer()
    requests.push({
      url: request.url(),
      method: request.method(),
      bodyHex: body === null ? null : body.toString('hex'),
    })

    const requestOrigin = new URL(request.url()).origin
    const appOrigin = new URL(context.page.url()).origin
    if (requestOrigin !== appOrigin) {
      await route.abort()
      return
    }
    await route.continue()
  })
}

export const stopPrivacyNetworkCapture: BrowserCommand = async (context) => {
  await context.page.unroute('**/*')
  const testPath = context.testPath ?? 'unknown'
  const requests = requestsByTest.get(testPath) ?? []
  requestsByTest.delete(testPath)
  return requests
}
