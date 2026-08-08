import {
  AccountError,
  AccountService,
  AccountUser,
  SaveLayerInput,
  SavedLayerMeta,
  SavedLayerRecord,
} from './types';

/**
 * REST-backed account provider (see server/index.js). Selected automatically
 * when the API answers the health probe, which makes accounts and uploaded
 * layers available across devices.
 */

const TOKEN_KEY = 'fieldar.token';

export class RemoteAccountService implements AccountService {
  readonly mode = 'remote' as const;

  constructor(private baseUrl: string) {}

  private get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    } catch {
      throw new AccountError('NETWORK');
    }
    if (!response.ok) {
      let code = `HTTP_${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) code = body.error;
      } catch {
        // keep the HTTP status code
      }
      throw new AccountError(code);
    }
    return (await response.json()) as T;
  }

  async currentUser(): Promise<AccountUser | null> {
    if (!this.token) return null;
    try {
      const { user } = await this.request<{ user: AccountUser }>('/api/auth/me');
      return user;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
  }

  async register(email: string, password: string): Promise<AccountUser> {
    const { token, user } = await this.request<{ token: string; user: AccountUser }>(
      '/api/auth/register',
      { method: 'POST', body: JSON.stringify({ email, password }) }
    );
    localStorage.setItem(TOKEN_KEY, token);
    return user;
  }

  async login(email: string, password: string): Promise<AccountUser> {
    const { token, user } = await this.request<{ token: string; user: AccountUser }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) }
    );
    localStorage.setItem(TOKEN_KEY, token);
    return user;
  }

  async logout(): Promise<void> {
    localStorage.removeItem(TOKEN_KEY);
  }

  async listLayers(): Promise<SavedLayerMeta[]> {
    const { layers } = await this.request<{ layers: SavedLayerMeta[] }>('/api/layers');
    return layers;
  }

  async saveLayer(input: SaveLayerInput): Promise<SavedLayerMeta> {
    const { layer } = await this.request<{ layer: SavedLayerMeta }>('/api/layers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return layer;
  }

  async updateLayer(id: string, input: SaveLayerInput): Promise<void> {
    await this.request(`/api/layers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async loadLayer(id: string): Promise<SavedLayerRecord> {
    const { layer } = await this.request<{ layer: SavedLayerRecord }>(
      `/api/layers/${encodeURIComponent(id)}`
    );
    return layer;
  }

  async deleteLayer(id: string): Promise<void> {
    await this.request(`/api/layers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

/** Detects whether an API server is reachable at the given base URL. */
export async function probeApi(baseUrl: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}
