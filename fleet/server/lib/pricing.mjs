// What each response would cost at API list prices, priced one response at a
// time the way the API bills it: Haiku 5.5's long-prompt prices, fast mode,
// US-only inference and web searches all depend on the response, not the day.
// The price table is Anthropic's published one (live-pricing.mjs), the bundled
// copy until that is read, and pricing-overrides.json over either.

import fs from 'node:fs'
import { DEFAULT_PRICING, PRICING_OVERRIDES_FILE } from './constants.mjs'
import { fetchLivePricing, isStale, readCachedPricing } from './live-pricing.mjs'
import { settings } from './state.mjs'
import { log } from './utils.mjs'

export function baseModel(model) {
  return String(model || '')
    .replace(/\[.*?\]$/, '')
    .replace(/-\d{8}$/, '')
}

// Overrides a person wrote: { "models": { "<id>": { "input": 3, ... } } }.
function readOverrides() {
  try {
    const overrides = JSON.parse(fs.readFileSync(PRICING_OVERRIDES_FILE, 'utf8'))
    return overrides && typeof overrides.models === 'object' ? overrides.models : {}
  } catch {
    return {}
  }
}

// Puts a table in use, with the overrides laid over it. True when the prices
// changed, which means every response has to be priced again.
function usePricing(table) {
  const models = JSON.parse(JSON.stringify(table.models))
  for (const [id, figures] of Object.entries(readOverrides())) models[id] = { ...models[id], ...figures }
  const next = { ...table, models }
  const priceKey = pricing => JSON.stringify([pricing.models, pricing.residency, pricing.webSearchPerThousand])
  const hasChanged = priceKey(next) !== priceKey(settings.pricing)
  settings.pricing = next
  return hasChanged
}

// At start: the last table read from the page, or the bundled one.
export function loadPricing() {
  return usePricing((settings.livePricing && readCachedPricing()) || DEFAULT_PRICING)
}

// Reads the page when the table in use is a day old (or never was read).
// `onChange` runs when the new prices differ from the ones in use.
export async function refreshLivePricing(onChange) {
  if (!settings.livePricing || !isStale(settings.pricing)) return
  const pricing = await fetchLivePricing()
  if (!pricing) return
  if (usePricing(pricing)) {
    log('prices changed on the pricing page; pricing every response again')
    onChange()
  }
}

// The table's row for a model, or for an unlisted one the newest listed model
// of its family (claude-opus-6 would be priced as the newest Opus).
const versionOf = id => (id.match(/\d+/g) || []).map(Number)
const isNewer = (left, right) => {
  const [leftVersion, rightVersion] = [versionOf(left), versionOf(right)]
  for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index++) {
    const [leftPart, rightPart] = [leftVersion[index] || 0, rightVersion[index] || 0]
    if (leftPart !== rightPart) return leftPart > rightPart
  }
  return false
}
function rateFor(model) {
  const models = settings.pricing.models
  if (models[model]) return { id: model, rate: models[model] }
  const family = model.match(/^claude-([a-z]+)/)?.[1]
  const newest = Object.keys(models).filter(id => family && id.startsWith(`claude-${family}-`)).reduce((best, id) => (!best || isNewer(id, best) ? id : best), '')
  return newest ? { id: newest, rate: models[newest] } : { id: '', rate: null }
}

// Whether US-only inference costs more on this model (4.6 and later).
function hasResidencyMultiplier(id) {
  const residency = settings.pricing.residency
  if (!residency) return false
  const [major = 0, minor = 0] = versionOf(id)
  const [fromMajor, fromMinor] = residency.fromVersion
  return major > fromMajor || (major === fromMajor && minor >= fromMinor)
}

// What one response cost, from its usage as the transcript records it.
export function responseCost(model, usage, tokens) {
  const { id, rate } = rateFor(model)
  const webSearches = usage.server_tool_use?.web_search_requests || 0
  const searchCost = (webSearches * (settings.pricing.webSearchPerThousand || 0)) / 1000
  if (!rate) return searchCost
  const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h
  let prices = rate.long && promptTokens > rate.long.overTokens ? rate.long : rate
  // Fast mode has its own input and output prices; the cache ones keep the model's multiples of input.
  if (usage.speed === 'fast' && rate.fast) {
    const scale = rate.fast.input / rate.input
    prices = { input: rate.fast.input, output: rate.fast.output, cacheRead: prices.cacheRead * scale, cacheWrite5m: prices.cacheWrite5m * scale, cacheWrite1h: prices.cacheWrite1h * scale }
  }
  const multiplier = usage.inference_geo === 'us' && hasResidencyMultiplier(id) ? settings.pricing.residency.multiplier : 1
  const tokenCost =
    (tokens.input * prices.input +
      tokens.output * prices.output +
      tokens.cacheRead * prices.cacheRead +
      tokens.cacheWrite5m * prices.cacheWrite5m +
      tokens.cacheWrite1h * prices.cacheWrite1h) /
    1_000_000
  return tokenCost * multiplier + searchCost
}

export function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, messages: 0, webSearches: 0, cost: 0 }
}

export function addTokens(into, from) {
  for (const key of Object.keys(into)) into[key] += from[key] || 0
}
