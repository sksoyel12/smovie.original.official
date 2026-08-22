/**
 * Shared API URL handling for the Expo client.
 *
 * Replit may provide either the routed origin or an already-routed `/api`
 * URL. Keep both forms valid so callers never accidentally request `/api/api`.
 */
// The imported workspace may still contain an old shared EXPO_PUBLIC_API_URL.
// During Replit development, the current routed domain is injected into
// EXPO_PUBLIC_DOMAIN and is the authoritative host for the API artifact.
const configuredUrl = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : process.env.EXPO_PUBLIC_API_URL ?? null;

const withoutTrailingSlash = (value: string): string =>
  value.replace(/\/+$/, "");

export const API_HOST: string | null = configuredUrl
  ? withoutTrailingSlash(configuredUrl).replace(/\/api$/, "")
  : null;

export const API_BASE: string | null = API_HOST ? `${API_HOST}/api` : null;