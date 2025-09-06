export interface ApiConfig {
  apiHost: string
}

export const apiConfig: ApiConfig = {
  apiHost: (import.meta as any).env?.VITE_API_HOST || 'http://localhost:8080',
}
