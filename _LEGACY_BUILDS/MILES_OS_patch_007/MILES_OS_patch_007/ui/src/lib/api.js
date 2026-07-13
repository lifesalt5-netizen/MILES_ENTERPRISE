const BASE_URL = import.meta.env.VITE_MILES_API || 'http://127.0.0.1:8765';

export async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const getHealth = () => api('/health');
export const getWork = () => api('/work');
export const getSegments = () => api('/segments');
export const bootstrap = () => api('/bootstrap', { method: 'POST' });
export const approveWork = (id) => api(`/work/${id}/approve`, { method: 'POST' });
export const completeWork = (id) => api(`/work/${id}/complete`, { method: 'POST' });
