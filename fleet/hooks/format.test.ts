import { expect, test } from 'claude-code/testing'

import { ago, baseName, fit, meter, oneLine, shortTokens } from './lib/format'

test('the pane writes token counts, ages and bars as the dashboard does', () => {
  expect(shortTokens(950)).toBe('950')
  expect(shortTokens(120_000)).toBe('120k')
  expect(shortTokens(1_250_000)).toBe('1.3M')
  expect(ago(120_000, 0)).toBe('')
  expect(ago(120_000, 90_000)).toBe('30s')
  expect(ago(4 * 3_600_000, 1)).toBe('4h')
  expect(meter(60, 8)).toBe('█████░░░')
})

test('names and prompts fit the row they are drawn in', () => {
  expect(baseName('/work/my-app/')).toBe('my-app')
  expect(fit('api-review', 20)).toBe('api-review')
  expect(fit('api-review', 5)).toBe('api-…')
  expect(fit('api-review', 1)).toBe('')
  expect(oneLine('  fix\n the   tests ')).toBe('fix the tests')
})
