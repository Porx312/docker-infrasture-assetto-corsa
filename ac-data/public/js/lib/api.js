export const API_BASE = '/admin';

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function apiFetch(path, init = {}) {
  /** @type {Record<string, string>} */
  const headers = { ...(init.headers ?? {}) };
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Invalid response (${res.status})`);
  }

  return { res, data };
}

/** @param {string} path */
export function apiGet(path) {
  return apiFetch(path);
}

/**
 * @param {string} path
 * @param {unknown} body
 */
export function apiPut(path, body) {
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(body) });
}

/**
 * @param {string} path
 * @param {FormData} body
 */
export function apiPostForm(path, body) {
  return apiFetch(path, { method: 'POST', body });
}

/** @param {string} path */
export function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}
