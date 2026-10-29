// The one way the page talks to the Fleet server.

export async function api(route, body) {
  // Signed in by an HttpOnly cookie; the header proves the request comes from this page.
  const response = await fetch(route, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: { 'x-fleet-request': '1', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 401) {
    const error = new Error('Not signed in: run /fleet web in any Claude session.')
    error.code = 'signin'
    throw error
  }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText)
  return response.json()
}
