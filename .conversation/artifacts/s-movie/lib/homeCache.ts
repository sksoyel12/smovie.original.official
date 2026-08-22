/**
 * homeCache — offline-first persistent cache for home screen data.
 *
 * Uses AsyncStorage to persist processed card arrays so the home screen
 * renders immediately from local storage when the device is offline or the
 * API is unreachable.  Fresh data is always fetched in the background and
 * overwrites the cache on success.
 *
 * Key scheme: `smovie_home_v2_<row-title>`
 * TTL-aware functions are used for hero banner (24 h) — regular rows have
 * no TTL (stale data is fine; fresh data replaces it whenever network succeeds).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "smovie_home_v2_";

/** Stable key for the hero banner section. */
export const HERO_CACHE_KEY = "__hero__";

// ─── Plain cache (no TTL) ─────────────────────────────────────────────────────

/**
 * Persist any JSON-serialisable value for a given row key.
 * Silently swallows errors (e.g. storage full) so a failed save never
 * disrupts the UI.
 */
export async function saveHomeCache(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    // Storage full or quota exceeded — non-fatal
  }
}

/**
 * Load a previously cached value.  Returns `null` when nothing is stored
 * or the stored JSON is corrupt.
 */
export async function loadHomeCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // TTL-wrapped format — extract just the data so plain callers still work
    if (parsed && typeof parsed === "object" && "__ttlV" in parsed) {
      return parsed.data as T;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

// ─── TTL-aware cache (hero banner) ────────────────────────────────────────────

/** Save data wrapped with a timestamp so freshness can be checked later. */
export async function saveHomeCacheTTL(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PREFIX + key,
      JSON.stringify({ __ttlV: 1, data, savedAt: Date.now() }),
    );
  } catch {}
}

/**
 * Load a cached value ONLY if it was saved within the given TTL window.
 * Returns `null` when the cache is missing, corrupt, or has expired.
 */
export async function loadHomeCacheTTL<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("__ttlV" in parsed)) return null;
    if (Date.now() - parsed.savedAt > ttlMs) return null; // expired
    return parsed.data as T;
  } catch {
    return null;
  }
}
