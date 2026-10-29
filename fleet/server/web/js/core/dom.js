// Small DOM helpers: a selector, a CSS custom property reader and the toast.

export const $ = selector => document.querySelector(selector)
export const cssVariable = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
export function toast(text) {
  const toastElement = $('#toast')
  toastElement.textContent = text
  toastElement.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => toastElement.classList.remove('show'), Math.max(3600, text.length * 55))
}
