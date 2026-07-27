import { apiFetch, API_BASE } from './api.js';

export async function checkAuth() {
  try {
    const { data } = await apiFetch('/check');
    if (!data.authenticated) {
      window.location.href = `${API_BASE}/login`;
      return false;
    }
    return true;
  } catch {
    window.location.href = `${API_BASE}/login`;
    return false;
  }
}

export async function logout() {
  try {
    await apiFetch('/logout', { method: 'POST' });
  } finally {
    window.location.href = `${API_BASE}/login`;
  }
}
