// Redrawing in place. The page is drawn again every two seconds from an HTML
// string; replacing the old elements with new ones each time restarted every
// animation, dropped hover and inner scroll positions, and made the chat jump.
// `morph` changes only what differs, so whatever stayed the same is the same
// element as before.

// A child that keeps its identity among its siblings when they are reordered
// or one is added above it: a session's row, a chat message.
const keyOf = node => (node.nodeType === Node.ELEMENT_NODE ? node.getAttribute('data-key') || node.getAttribute('data-id') || '' : '')
const isSameKind = (first, second) => first.nodeType === second.nodeType && first.nodeName === second.nodeName

function syncAttributes(from, to) {
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name)
  // Copied as a node: a name the parser accepted but setAttribute would refuse still carries over.
  for (const attribute of to.attributes) if (from.getAttribute(attribute.name) !== attribute.value) from.setAttributeNode(attribute.cloneNode())
}

// What a person typed or ticked lives in properties, not attributes: follow the
// new HTML only where it says something different from what is shown.
function syncFormState(from, to) {
  if (from.nodeName === 'INPUT' && (from.type === 'checkbox' || from.type === 'radio')) { if (from.checked !== to.checked) from.checked = to.checked }
  else if (from.nodeName === 'INPUT' || from.nodeName === 'TEXTAREA' || from.nodeName === 'SELECT') { if (from.value !== to.value) from.value = to.value }
}

function morphNode(from, to) {
  if (from.nodeType !== Node.ELEMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue
    return
  }
  // `data-steady` marks an element whose attributes only say where a running
  // animation started: changing them would make it jump.
  if (!(from.hasAttribute('data-steady') && to.hasAttribute('data-steady'))) syncAttributes(from, to)
  // A message box's text is its value; rewriting the text inside it moves the caret.
  if (from.nodeName !== 'TEXTAREA') morphChildren(from, to)
  syncFormState(from, to)
}

function morphChildren(from, to) {
  const keyed = new Map()
  for (const child of from.children) { const key = keyOf(child); if (key && !keyed.has(key)) keyed.set(key, child) }
  let cursor = from.firstChild
  for (const wanted of [...to.childNodes]) {
    const key = keyOf(wanted)
    let match = key ? keyed.get(key) : cursor && !keyOf(cursor) ? cursor : null
    if (match && !isSameKind(match, wanted)) match = null
    if (!match) { from.insertBefore(wanted, cursor); continue }
    if (key) keyed.delete(key)
    if (match === cursor) cursor = cursor.nextSibling
    else from.insertBefore(match, cursor)
    morphNode(match, wanted)
  }
  while (cursor) { const gone = cursor; cursor = cursor.nextSibling; gone.remove() }
}

export function morph(target, html) {
  const wanted = target.cloneNode(false)
  wanted.innerHTML = html
  morphChildren(target, wanted)
}
