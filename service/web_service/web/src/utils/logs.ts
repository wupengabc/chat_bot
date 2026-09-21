import {get} from './request'

export type LogType = 'info' | 'warn' | 'error'
export interface SystemLog { id: number; time: string; platform: string; plugin: string; type: LogType; msg: string }
export interface LogFilters { platform?: string; plugin?: string; type?: LogType; keyword?: string; time_from?: string; time_to?: string }

export function adminLogsRequest(page: number, limit: number, filters: LogFilters) {
  const query = new URLSearchParams({page: String(page), limit: String(limit)})
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  return get<{logs: SystemLog[]; pagination: {page: number; total: number; total_pages: number; has_previous: boolean; has_next: boolean}}>(`/api/admin/logs?${query}`)
}

export function adminLogMetaRequest(platform?: string) {
  const query = platform ? `?platform=${encodeURIComponent(platform)}` : ''
  return get<{platforms: string[]; plugins: string[]; types: string[]}>(`/api/admin/logs/meta${query}`)
}
