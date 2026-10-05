const backend = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

// Empty in local development, where Vite proxies /api to the backend.
export function apiUrl(path: string) {
  return `${backend}/api/${path.replace(/^\/+/, "")}`;
}
