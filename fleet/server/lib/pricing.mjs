// Token prices (pricing.json, editable) and what a model's traffic would cost
// at API list prices, plus the token tallies the reports add up.

import fs from 'node:fs'
import { DEFAULT_PRICING, PRICING_FILE } from './constants.mjs'
import { settings } from './state.mjs'
import { writePrivate } from './utils.mjs'

export function loadPricing() {
  try {
    settings.pricing = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'))
  } catch {
    settings.pricing = DEFAULT_PRICING
    try {
      writePrivate(PRICING_FILE, JSON.stringify(DEFAULT_PRICING, null, 2))
    } catch {}
  }
}

export function baseModel(model) {
  return String(model || '')
    .replace(/\[.*?\]$/, '')
    .replace(/-\d{8}$/, '')
}

export function priceFor(model) {
  const models = settings.pricing.models || {}
  const base = baseModel(model)
  let rate = models[base]
  if (!rate) {
    // An unlisted version of a known family takes that family's newest listed price.
    const family = ['fable', 'opus', 'sonnet', 'haiku'].find(name => base.includes(name))
    const fallbackKey = family && Object.keys(models).find(key => key.includes(family))
    rate = fallbackKey ? models[fallbackKey] : { input: 0, output: 0 }
  }
  return {
    input: rate.input,
    output: rate.output,
    cacheRead: rate.cacheRead ?? rate.input * 0.1,
    cacheWrite5m: rate.cacheWrite5m ?? rate.input * 1.25,
    cacheWrite1h: rate.cacheWrite1h ?? rate.input * 2,
  }
}

export function costOf(model, tokens) {
  const rate = priceFor(model)
  return (
    (tokens.input * rate.input +
      tokens.output * rate.output +
      tokens.cacheRead * rate.cacheRead +
      tokens.cacheWrite5m * rate.cacheWrite5m +
      tokens.cacheWrite1h * rate.cacheWrite1h) /
    1_000_000
  )
}

export function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, messages: 0 }
}

export function addTokens(into, from) {
  for (const key of Object.keys(into)) into[key] += from[key] || 0
}
