import { ESLint } from 'eslint'
import { expect, test } from 'vitest'

const cases = [
  ['src/domain/valid.ts', "import './peer'", false],
  ['src/domain/invalid.ts', "import React from 'react'", true],
  ['src/application/valid.ts', "import '../domain/model'", false],
  ['src/application/invalid.ts', "import '../infrastructure/adapter'", true],
  ['src/infrastructure/valid.ts', "import '../application/use-case'", false],
  ['src/infrastructure/invalid.ts', "import '../ui/App'", true],
] as const

test.each(cases)('%s follows its import boundary', async (filePath, code, rejected) => {
  const [result] = await new ESLint().lintText(code, { filePath })
  const boundaryErrors = result.messages.filter(
    ({ ruleId }) => ruleId === 'no-restricted-imports',
  )
  expect(boundaryErrors.length > 0).toBe(rejected)
})
