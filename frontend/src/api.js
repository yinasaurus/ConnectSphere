export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error('We could not reach the server. Check your connection and try again.');
    error.code = 'NETWORK_ERROR';
    error.status = 0;
    throw error;
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || 'Request failed');
    error.status = res.status;
    error.code = data.error;
    error.details = data.details;
    throw error;
  }
  return data;
}
