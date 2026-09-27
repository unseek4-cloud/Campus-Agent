import assert from 'node:assert/strict'

export function credentials(role = 'STUDENT') {
  const username = process.env[`${role}_USERNAME`], password = process.env[`${role}_PASSWORD`]
  assert.ok(username && password, `Set ${role}_USERNAME and ${role}_PASSWORD to database test accounts`)
  return { username, password }
}

export async function loginApi(api, baseURL, account) {
  const csrfResponse = await api.get(baseURL + '/api/auth/csrf')
  assert.equal(csrfResponse.status(), 200)
  const csrf = (await csrfResponse.json()).data
  const headers = { [csrf.headerName]: csrf.token }
  const login = await api.post(baseURL + '/api/auth/login', { headers, data: account })
  assert.equal(login.status(), 200, 'Database test account must log in successfully')
  const fresh = (await (await api.get(baseURL + '/api/auth/csrf')).json()).data
  return { [fresh.headerName]: fresh.token }
}

export async function loginContext(context, baseURL, role = 'STUDENT') {
  const headers = await loginApi(context.request, baseURL, credentials(role))
  await context.setExtraHTTPHeaders(headers)
  return headers
}
