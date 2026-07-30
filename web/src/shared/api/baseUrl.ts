/**
 * 后端 API 的基础路径。构建时通过 Vite 环境变量 VITE_API_BASE_URL 注入，
 * 默认走同源反向代理前缀 `/api`。末尾斜杠会被去除以便安全拼接。
 */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL ?? '/api';
  return configured.replace(/\/+$/, '');
}
