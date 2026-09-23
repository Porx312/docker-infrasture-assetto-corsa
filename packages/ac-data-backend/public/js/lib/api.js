import { appendFleetEdgeQuery, withFleetEdgeQuery } from './fleet.js';

export const API_BASE = '/admin';

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {string} [fleetEdgeId]
 */
export async function apiFetch(path, init = {}, fleetEdgeId) {
  const basePath = appendFleetEdgeQuery(path);
  const resolvedPath = fleetEdgeId ? withFleetEdgeQuery(basePath, fleetEdgeId) : basePath;
  /** @type {Record<string, string>} */
  const headers = { ...(init.headers ?? {}) };
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${resolvedPath}`, {
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

/** @param {string} path @param {string} [fleetEdgeId] */
export function apiGet(path, fleetEdgeId) {
  return apiFetch(path, {}, fleetEdgeId);
}

/**
 * @param {string} path
 * @param {unknown} body
 * @param {string} [fleetEdgeId]
 */
export function apiPut(path, body, fleetEdgeId) {
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(body) }, fleetEdgeId);
}

/**
 * @param {string} path
 * @param {unknown} [body]
 * @param {string} [fleetEdgeId]
 */
export function apiPost(path, body = {}, fleetEdgeId) {
  return apiFetch(
    path,
    { method: 'POST', body: JSON.stringify(body) },
    fleetEdgeId,
  );
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
export function apiPostFormWithProgress(path, body, onProgress, fleetEdgeId) {
  const basePath = appendFleetEdgeQuery(path);
  const resolvedPath = fleetEdgeId ? withFleetEdgeQuery(basePath, fleetEdgeId) : basePath;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${resolvedPath}`);
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
