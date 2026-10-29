export const $ = selector => document.querySelector(selector)
export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
export function toast(text) {
  const el = $('#toast')
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), Math.max(3600, text.length * 55))
}
