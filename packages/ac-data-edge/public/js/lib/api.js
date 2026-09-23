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
    const restartHint =
      res.status === 404 ? ' — endpoint not found; try restarting ac-data' : '';
    data = { ok: false, message: `Server error (${res.status})${restartHint}` };
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

/**
 * POST multipart with upload byte progress (fetch cannot report upload progress).
 *
 * @param {string} path
 * @param {FormData} body
 * @param {(loaded: number, total: number) => void} [onProgress]
 * @returns {Promise<{ res: { status: number; ok: boolean }; data: Record<string, unknown> }>}
 */
export function apiPostFormWithProgress(path, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (event) => {
      onProgress?.(event.loaded, event.lengthComputable ? event.total : 0);
    });

    xhr.addEventListener('load', () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        const restartHint =
          xhr.status === 404 ? ' — endpoint not found; try restarting ac-data' : '';
        data = { ok: false, message: `Server error (${xhr.status})${restartHint}` };
      }
      resolve({
        res: { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300 },
        data,
      });
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.send(body);
  });
}

/** @param {string} path */
export function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}
