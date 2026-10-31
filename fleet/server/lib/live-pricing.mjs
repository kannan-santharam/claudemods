// Prices read from Anthropic's published pricing page, once a day: the per-model
// table (with Haiku 5.5's long-prompt prices), fast mode, the US-only inference
// multiplier and the web search fee. The parsed table is kept in
// pricing-live.json, so a restart starts from the last one read; until any is
// read, the table bundled in constants.mjs stands.

import fs from 'node:fs'
import { DAY_MS, LIVE_PRICING_FILE, PRICING_PAGE_URL } from './constants.mjs'
import { log, writePrivate } from './utils.mjs'

const FETCH_TIMEOUT_MS = 10_000
const PAGE_MAX_BYTES = 2 * 1024 * 1024
// A table missing any of these is a page this parser no longer understands.
const REQUIRED_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']

// "Claude Opus 5.5" → claude-opus-5-5, with any link, footnote or note removed.
function modelIdOf(name) {
  const plain = name
    .replace(/<sup>.*?<\/sup>/g, '')
    .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
  const match = plain.match(/^Claude\s+([A-Za-z]+)\s+(\d+(?:\.\d+)?)$/)
  return match ? `claude-${match[1].toLowerCase()}-${match[2].replace('.', '-')}` : ''
}
const priceOf = cell => {
  const match = String(cell).replace(/,/g, '').match(/\$\s*(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : NaN
}
const tableRows = text => text.split('\n').filter(line => line.startsWith('|') && !/^\|\s*:?-/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))

// The text from a heading to the next heading of the same or a higher level.
function sectionOf(page, heading) {
  const start = page.indexOf(heading)
  if (start < 0) return ''
  const level = heading.match(/^#+/)[0].length
  const rest = page.slice(start + heading.length)
  const next = rest.search(new RegExp(`\\n#{1,${level}} `))
  return next < 0 ? rest : rest.slice(0, next)
}

export function parsePricingPage(page) {
  const models = {}
  for (const cells of tableRows(sectionOf(page, '## Model pricing'))) {
    if (cells.length < 6 || cells[1].startsWith('Base input')) continue
    const id = modelIdOf(cells[0])
    if (!id) continue
    const [input, cacheWrite5m, cacheWrite1h, cacheRead, output] = cells.slice(1, 6).map(priceOf)
    const rate = { input, cacheWrite5m, cacheWrite1h, cacheRead, output }
    // Haiku 5.5's second row: the prices for a prompt over a number of tokens.
    const over = cells[0].match(/over\s+([\d,]+)\s+tokens/i)
    if (over && models[id]) models[id].long = { overTokens: Number(over[1].replace(/,/g, '')), ...rate }
    else if (!models[id]) models[id] = rate
  }
  for (const cells of tableRows(sectionOf(page, '### Fast mode pricing'))) {
    if (cells.length < 3 || cells[0] === 'Model') continue
    for (const name of cells[0].split('/')) {
      const id = modelIdOf(name.trim())
      if (models[id]) models[id].fast = { input: priceOf(cells[1]), output: priceOf(cells[2]) }
    }
  }
  const residencyText = sectionOf(page, '### Data residency pricing')
  const multiplier = Number(residencyText.match(/(\d+(?:\.\d+)?)x multiplier/)?.[1])
  const fromVersion = residencyText.match(/Claude (\d+)\.(\d+) and later/)
  const webSearch = Number(page.match(/\$(\d+(?:\.\d+)?)\s*(?:USD\s*)?per 1,000 searches/)?.[1])
  return {
    models,
    residency: multiplier && fromVersion ? { multiplier, fromVersion: [Number(fromVersion[1]), Number(fromVersion[2])] } : null,
    webSearchPerThousand: Number.isFinite(webSearch) ? webSearch : null,
  }
}

// Whether a parsed table is whole and sane enough to price with.
export function isUsablePricing(pricing) {
  const rates = Object.values(pricing.models || {})
  const isSane = rate => [rate.input, rate.cacheWrite5m, rate.cacheWrite1h, rate.cacheRead, rate.output].every(price => Number.isFinite(price) && price > 0) && rate.output >= rate.input
  return rates.length >= 8 && rates.every(isSane) && REQUIRED_MODELS.every(id => pricing.models[id]) && Boolean(pricing.residency) && pricing.webSearchPerThousand != null
}

export function readCachedPricing() {
  try {
    const cached = JSON.parse(fs.readFileSync(LIVE_PRICING_FILE, 'utf8'))
    return isUsablePricing(cached) ? cached : null
  } catch {
    return null
  }
}

// Reads the page and keeps the table when it parses whole. Null otherwise; the
// table in use then stays.
export async function fetchLivePricing() {
  try {
    const response = await fetch(PRICING_PAGE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'text/markdown' } })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    const page = await response.text()
    if (page.length > PAGE_MAX_BYTES) throw new Error('page too large')
    const pricing = { ...parsePricingPage(page), source: 'live', fetchedAt: Date.now() }
    if (!isUsablePricing(pricing)) throw new Error('page did not parse into a whole price table')
    writePrivate(LIVE_PRICING_FILE, JSON.stringify(pricing, null, 2))
    return pricing
  } catch (error) {
    log('live pricing not read:', error.message)
    return null
  }
}

export const isStale = pricing => !pricing?.fetchedAt || Date.now() - pricing.fetchedAt > DAY_MS
