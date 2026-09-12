/**
 * Shared API URL handling for the Expo client.
 *
 * Replit may provide either the routed origin or an already-routed `/api`
 * URL. Keep both forms valid so callers never accidentally request `/api/api`.
 */
// During Replit development, EXPO_PUBLIC_DOMAIN is injected by the mobile
// workflow. Keep the other Replit domain as a defensive fallback so the API
// host cannot become null when Expo evaluates this module before the workflow
// command has copied the public domain into EXPO_PUBLIC_DOMAIN.
const isUsableValue = (value: string | undefined): value is string =>
  Boolean(value && value.trim() && value !== "null" && value !== "undefined");

const configuredUrl = isUsableValue(process.env.EXPO_PUBLIC_DOMAIN)
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : isUsableValue(process.env.EXPO_PUBLIC_API_URL)
  ? process.env.EXPO_PUBLIC_API_URL
  : isUsableValue(process.env.REPLIT_DEV_DOMAIN)
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : null;

const withoutTrailingSlash = (value: string): string =>
  value.replace(/\/+$/, "");

export const API_HOST: string | null = configuredUrl
  ? withoutTrailingSlash(configuredUrl).replace(/\/api$/, "")
  : null;

export const API_BASE: string | null = API_HOST ? `${API_HOST}/api` : null;

if (__DEV__) {
  console.log("[TMDB] API_HOST resolved", API_HOST ?? "null");
}