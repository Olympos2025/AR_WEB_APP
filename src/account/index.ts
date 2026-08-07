import { LocalAccountService } from './localAccount';
import { RemoteAccountService, probeApi } from './remoteAccount';
import { AccountService } from './types';

export * from './types';

/**
 * Picks the account backend: the REST API when reachable (same origin or
 * VITE_API_URL), otherwise device-local storage so accounts still work on
 * purely static hosting such as GitHub Pages.
 */
export async function createAccountService(): Promise<AccountService> {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
  const candidates = configured ? [configured] : [''];
  for (const baseUrl of candidates) {
    if (await probeApi(baseUrl)) {
      return new RemoteAccountService(baseUrl);
    }
  }
  return new LocalAccountService();
}
