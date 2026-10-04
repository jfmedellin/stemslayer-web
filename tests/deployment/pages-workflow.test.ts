import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const workflowPath = fileURLToPath(new URL('../../.github/workflows/pages.yml', import.meta.url))
const viteConfigPath = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))

function normalizeWorkflow(workflow: string): string {
  return workflow.replace(/\r\n/g, '\n')
}

function mappingEntries(workflow: string, key: string, indent: number): string[] {
  const lines = workflow.split('\n')
  const sectionIndex = lines.findIndex((line) => {
    const indentation = line.length - line.trimStart().length
    return indentation === indent && line.trim() === `${key}:`
  })
  if (sectionIndex === -1) return []

  const entries: string[] = []
  for (const line of lines.slice(sectionIndex + 1)) {
    if (line.trim() === '') continue
    const indentation = line.length - line.trimStart().length
    if (indentation <= indent) break
    if (indentation !== indent + 2) continue

    const entry = line.trim().match(/^([\w-]+):(?:\s*(.*))?$/)
    if (entry) entries.push(`${entry[1]}: ${entry[2] ?? ''}`.trimEnd())
  }
  return entries
}

function jobBlock(workflow: string, jobName: string): string {
  const lines = workflow.split('\n')
  const jobStart = lines.findIndex((line) => {
    const indentation = line.length - line.trimStart().length
    return indentation === 2 && line.trim() === `${jobName}:`
  })
  expect(jobStart, `workflow must define the ${jobName} job`).toBeGreaterThanOrEqual(0)
  if (jobStart === -1) return ''

  const jobLines = []
  for (const line of lines.slice(jobStart + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= 2) break
    jobLines.push(line)
  }
  return jobLines.join('\n')
}

function stepBlocks(job: string): Array<[string, string[]]> {
  const lines = job.split('\n')
  const stepsIndex = lines.findIndex((line) => {
    const indentation = line.length - line.trimStart().length
    return indentation === 4 && line.trim() === 'steps:'
  })
  if (stepsIndex === -1) return []

  const steps: Array<[string, string[]]> = []
  let stepLines: string[] = []
  const finishStep = (): void => {
    if (stepLines.length === 0) return
    const action = stepLines
      .map((line) => line.trim().replace(/^-\s*/, ''))
      .find((line) => line.startsWith('uses:'))
      ?.slice('uses:'.length)
      .trim() ?? ''
    steps.push([action, mappingEntries(stepLines.join('\n'), 'with', 8)])
    stepLines = []
  }

  for (const line of lines.slice(stepsIndex + 1)) {
    if (line.trim() === '') {
      if (stepLines.length > 0) stepLines.push(line)
      continue
    }
    const indentation = line.length - line.trimStart().length
    if (indentation <= 4) break
    if (indentation === 6 && line.trimStart().startsWith('- ')) finishStep()
    if (stepLines.length > 0 || indentation === 6) stepLines.push(line)
  }
  finishStep()
  return steps
}

describe('GitHub Pages workflow contract', () => {
  test('keeps each step with only its own inputs and preserves deploy step order', () => {
    const deploy = [
      '    steps:',
      '      - uses: actions/download-artifact@v4',
      '        with:',
      '          name: pages-dist',
      '          path: dist',
      '      - uses: actions/upload-pages-artifact@v4',
      '        with:',
      '          path: dist',
      '      - uses: actions/deploy-pages@v4',
    ].join('\n')

    expect(stepBlocks(deploy)).toEqual([
      ['actions/download-artifact@v4', ['name: pages-dist', 'path: dist']],
      ['actions/upload-pages-artifact@v4', ['path: dist']],
      ['actions/deploy-pages@v4', []],
    ])
  })

  test('limits Pages permissions to the guarded deploy job and transfers the built artifact', async () => {
    const workflow = normalizeWorkflow(await readFile(workflowPath, 'utf8'))
    const validate = jobBlock(workflow, 'validate')
    const deploy = jobBlock(workflow, 'deploy')
    const validateProperties = mappingEntries(workflow, 'validate', 2)
    const deployProperties = mappingEntries(workflow, 'deploy', 2)

    const triggers = mappingEntries(workflow, 'on', 0)
    expect(triggers).toEqual(['push:', 'pull_request:'])
    expect(mappingEntries(workflow, 'permissions', 0)).toEqual(['contents: read'])
    expect(mappingEntries(validate, 'permissions', 4)).toEqual(['contents: read'])
    expect(validateProperties.some((property) => property.startsWith('if:'))).toBe(false)
    expect(stepBlocks(validate)).toContainEqual([
      'actions/upload-artifact@v4',
      ['name: pages-dist', 'path: dist', 'retention-days: 1'],
    ])

    expect(deployProperties).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'")
    expect(deployProperties).toContain('needs: validate')
    expect(deploy).toMatch(/^\s*name: github-pages$/m)
    expect(mappingEntries(deploy, 'permissions', 4).sort()).toEqual(['id-token: write', 'pages: write'])
    const deploySteps = stepBlocks(deploy)
    expect(deploySteps).toEqual([
      ['actions/download-artifact@v4', ['name: pages-dist', 'path: dist']],
      ['actions/upload-pages-artifact@v4', ['path: dist']],
      ['actions/deploy-pages@v4', []],
    ])
    expect(validate).not.toMatch(/actions\/(?:upload-pages-artifact|deploy-pages)@/)
  })

  test('uses the repository Pages base path in Actions and root locally', async () => {
    const viteConfig = await readFile(viteConfigPath, 'utf8')

    expect(viteConfig).toMatch(/base:\s*process\.env\.GITHUB_ACTIONS\s*\?\s*'\/stemslayer-web\/'\s*:\s*'\/'/)
  })
})
