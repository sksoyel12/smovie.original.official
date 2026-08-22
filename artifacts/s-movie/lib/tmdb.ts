import { API_HOST } from "@/lib/apiBase";

// ─── Server-side TMDB proxy ────────────────────────────────────────────────────
// Route all TMDB API calls through our Replit api-server so they work even when
// api.themoviedb.org is DNS-blocked on the user's ISP. Falls back to direct
// TMDB calls when EXPO_PUBLIC_DOMAIN is not set (e.g. in unit tests).
const _PROXY_HOST = API_HOST;
const TMDB_PROXY_BASE: string | null = _PROXY_HOST ? `${_PROXY_HOST}/api/tmdb` : null;
const IMG_BASE = "https://image.tmdb.org/t/p";
// Image proxy priority:
//   1. Our Replit server (/api/image) — NEVER blocked by Indian ISPs (Jio/Airtel/BSNL)
//   2. wsrv.nl — Cloudflare CDN, edge-cached, usually unblocked
//   3. images.weserv.nl — secondary CDN fallback
const TMDB_IMG_PROXY: string | null = _PROXY_HOST
  ? `${_PROXY_HOST}/api/image?url=`
  : null;
const PROXY_PRIMARY   = "https://wsrv.nl/?url=";
const PROXY_SECONDARY = "https://images.weserv.nl/?url=";

const FETCH_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;

// ─── Concurrent request limiter ───────────────────────────────────────────────
// Caps simultaneous TMDB calls to 16 for faster parallel loading.
const QUEUE_LIMIT = 16;
let _qActive = 0;
const _qPending: Array<() => void> = [];

function _acquireSlot(): Promise<void> {
  if (_qActive < QUEUE_LIMIT) {
    _qActive++;
    return Promise.resolve();
  }
  return new Promise<void>((res) => _qPending.push(res));
}
function _releaseSlot(): void {
  if (_qPending.length > 0) {
    // hand the slot directly to the next waiter (active count unchanged)
    (_qPending.shift()!)();
  } else {
    _qActive--;
  }
}

/** Wrap a direct image URL through the primary proxy (weserv.nl). */
export function wrapProxy(directUrl: string, proxy = PROXY_PRIMARY): string {
  return `${proxy}${directUrl}`;
}

/** @deprecated use wrapProxy — kept for internal callers */
function wrapWeserv(directUrl: string): string {
  return wrapProxy(directUrl, PROXY_PRIMARY);
}

/**
 * Build a reasonably sized TMDB image URL.
 *
 * Keep the size at the call site when the image has a known role:
 * - w342 for posters in cards, rows, and lists
 * - w500 for detail posters
 * - w1280 for detail hero/backdrop artwork
 *
 * The old default was w780, which made every small card download a much
 * larger image than it could display.
 */
export const tmdbImg = (path: string | null | undefined, size = "w342"): string | null => {
  if (!path) return null;
  const direct = `https://image.tmdb.org/t/p/${size}${path}`;
  return TMDB_IMG_PROXY
    ? `${TMDB_IMG_PROXY}${encodeURIComponent(direct)}`   // server proxy — never ISP-blocked
    : `${PROXY_PRIMARY}${direct}`;                        // wsrv.nl fallback
};

/**
 * Backwards-compatible name for older callers. It no longer requests TMDB's
 * original asset; callers should use tmdbImg directly when the role is known.
 */
export const tmdbOriginal = (
  path: string | null | undefined,
  size: "w342" | "w500" | "w780" | "w1280" = "w500",
): string | null => tmdbImg(path, size);

// ─── Random poster (Netflix trick) ────────────────────────────────────────────
// In-memory cache: "mediaType:tmdbId" → array of file_path strings
const _posterCache = new Map<string, string[]>();

/** Wipe the in-memory poster cache so the next fetch pulls fresh artwork. */
export function clearPosterCache(): void {
  _posterCache.clear();
}

/**
 * Fetch available poster alternatives from the TMDB /images endpoint.
 *
 * English posters are requested first and always win over textless artwork.
 * Textless artwork is only used as a last resort when TMDB has no English
 * poster for the title. This prevents clean character art from replacing the
 * official title card on browse surfaces.
 */
export async function fetchMoviePosters(
  tmdbId: number,
  mediaType: "movie" | "tv" = "movie",
): Promise<string[]> {
  const cacheKey = `${mediaType}:${tmdbId}`;
  if (_posterCache.has(cacheKey)) return _posterCache.get(cacheKey)!;
  try {
    const fetchImages = (includeImageLanguage: string) =>
      get<{
        posters?: Array<{
          file_path: string;
          iso_639_1: string | null;
          vote_average?: number;
          vote_count?: number;
        }>;
      }>(`/${mediaType}/${tmdbId}/images`, {
        include_image_language: includeImageLanguage,
      });

    // Query English first. This is intentionally not "en,null": TMDB will
    // otherwise return clean art alongside title posters and it is easy for a
    // popularity sort to pick the wrong one.
    const englishData = await fetchImages("en");
    const english = (englishData.posters ?? []).filter((poster) => poster.iso_639_1 === "en");

    // Only ask for null-language art if no English title poster exists.
    const candidates = english.length > 0
      ? english
      : (await fetchImages("en,null")).posters?.filter((poster) => poster.iso_639_1 === null) ?? [];

    const sorted = [...candidates].sort((a, b) => {
      const ratingDifference = (b.vote_average ?? 0) - (a.vote_average ?? 0);
      if (ratingDifference !== 0) return ratingDifference;
      return (b.vote_count ?? 0) - (a.vote_count ?? 0);
    });

    // Keep up to 50 entries for stable rotation without loading a huge pool.
    const paths = sorted.slice(0, 50).map((poster) => poster.file_path);
    _posterCache.set(cacheKey, paths);
    return paths;
  } catch {
    _posterCache.set(cacheKey, []);
    return [];
  }
}

/**
 * Netflix-style dynamic poster: picks from the top text-logo posters returned
 * by fetchMoviePosters (which sorts en/hi language posters before textless ones).
 * Uses a 15-hour rotation_key so the same title shows different artwork across
 * visits without flickering mid-session. tmdbId provides per-title entropy so
 * concurrent titles don't all land on the same poster index.
 * Falls back to `fallbackPath` when no alternatives exist.
 * Returns a fully-proxied, card-sized image URI.
 */
export async function fetchRandomPosterUri(
  tmdbId: number,
  mediaType: "movie" | "tv",
  fallbackPath: string | null | undefined,
): Promise<string | null> {
  const posters = await fetchMoviePosters(tmdbId, mediaType);
  if (posters.length > 0) {
    // Use rotation_key (15-hour window) + tmdbId entropy for deterministic
    // but varied selection — no Math.random() so the poster stays stable
    // throughout a browsing session and only rotates every 15 hours.
    const rotationKey = Math.floor(Date.now() / (15 * 60 * 60 * 1000));
    const pool = posters.slice(0, Math.min(50, posters.length));
    const idx  = Math.abs(rotationKey * 31 + tmdbId) % pool.length;
    return tmdbImg(pool[idx], "w342");
  }
  return tmdbImg(fallbackPath, "w342");
}

/**
 * Returns the detail-page poster path (images[1]) so the detail screen shows
 * different artwork than the home screen (which uses rotation_key-based index).
 * Falls back to images[0] when only one poster exists.
 */
export async function fetchDetailPosterUri(
  tmdbId: number,
  mediaType: "movie" | "tv",
  fallbackPath: string | null | undefined,
): Promise<string | null> {
  const posters = await fetchMoviePosters(tmdbId, mediaType);
  if (posters.length > 0) {
    const pick = posters.length > 1 ? posters[1] : posters[0];
    return tmdbImg(pick, "w500");
  }
  return tmdbImg(fallbackPath, "w500");
}

export const proxyUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  if (typeof url !== "string") return null;
  // Already proxied through either proxy
  if (url.includes("wsrv.nl") || url.includes("weserv.nl")) return url;
  if (url.startsWith("/")) return tmdbImg(url);
  if (url.includes("image.tmdb.org")) {
    const optimized = url.replace("/t/p/original/", "/t/p/w500/");
    return wrapProxy(optimized);
  }
  if (url.startsWith("http://")) return url.replace("http://", "https://");
  return url;
};

/** Secondary proxy URL — used by SmartImage retry chain on failure. */
export { PROXY_PRIMARY, PROXY_SECONDARY };

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  await _acquireSlot();
  let lastError: Error | null = null;
  try {
    // ── Path 1: server-side proxy (bypasses ISP blocks on api.themoviedb.org) ──
    if (TMDB_PROXY_BASE) {
      const url = new URL(`${TMDB_PROXY_BASE}${endpoint}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetchWithTimeout(url.toString(), { headers: { Accept: "application/json" } }, FETCH_TIMEOUT_MS);
          if (!res.ok) {
            if (res.status === 429) { await new Promise((r) => setTimeout(r, attempt * 1200)); continue; }
            throw new Error(`TMDB proxy ${res.status}`);
          }
          return (await res.json()) as T;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }
      // Keep the API key server-side; do not make a direct client request.
    }
  } finally {
    _releaseSlot();
  }
  throw lastError ?? new Error("TMDB fetch failed");
}

export interface TMDBMovie {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  /** Live engagement score returned by every TMDB list/trending endpoint. */
  popularity?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids: number[];
  media_type?: string;
}

export interface TMDBPage {
  page: number;
  results: TMDBMovie[];
  total_pages: number;
  total_results: number;
}

export interface TMDBSeason {
  season_number: number;
  name: string;
  episode_count: number;
  poster_path: string | null;
  air_date: string | null;
}

export interface TMDBDetail {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  genres: { id: number; name: string }[];
  networks?: { id: number; name: string }[];
  runtime?: number;
  episode_run_time?: number[];
  seasons?: TMDBSeason[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  release_date?: string;
  first_air_date?: string;
  original_language?: string;
  spoken_languages?: { iso_639_1: string; english_name?: string; name?: string }[];
}

export interface TMDBTranslationsResponse {
  id: number;
  translations: { iso_639_1: string; iso_3166_1: string; english_name?: string; name?: string }[];
}

export interface TMDBEpisode {
  id: number;
  episode_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  runtime: number | null;
  air_date: string | null;
}

export interface TMDBCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface TMDBSeasonDetail {
  episodes: TMDBEpisode[];
}

export const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
  53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News",
  10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
  10767: "Talk", 10768: "War & Politics",
};

/** ISO date string for today — used as the upper ceiling on every discover query
 *  so unreleased / future-dated titles never appear in category rows.         */
const TODAY = new Date().toISOString().split("T")[0];
const NETFLIX_NETWORK_ID = 213;

// ─── Daily rotation helpers (Hero Banner) ─────────────────────────────────────
// The Hero Banner must swap its featured category/backdrop roughly every 24
// hours rather than reshuffling on every app open. These helpers derive a
// seed from today's calendar date (stable all day, changes at midnight local
// time) so rotation is deterministic within a day but moves forward daily.

/** Stable per-day integer seed — e.g. 2026-07-14 → 20260714. Same all day. */
export function dailySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Cheap integer hash so sequential day-seeds spread out instead of clustering. */
function hashSeed(seed: number): number {
  return Math.abs(Math.imul(seed, 2654435761) ^ (seed >>> 13));
}

/**
 * Deterministic "random" index into a pool of size `poolSize`, stable for the
 * whole calendar day and shifting to a new value once every 24 hours.
 * `salt` lets multiple independent rotations (e.g. one per content pool) use
 * the same day without landing on the same index.
 */
export function dailyRotationIndex(poolSize: number, salt = 0): number {
  if (poolSize <= 0) return 0;
  return hashSeed(dailySeed() + salt * 97) % poolSize;
}

/** Rotates an array so it starts at `offset` — used to change which item
 *  leads the Hero Banner every day without discarding the rest of the pool. */
export function rotateArray<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return items;
  const o = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(o), ...items.slice(0, o)];
}

export const tmdb = {
  trending: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/all/week", { page }),

  trendingMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/movie/week", { page }),

  /** Daily trending feature movies — the correct source for the Hero Banner
   *  so the backdrop rotates across a fresh 24-hour engagement snapshot. */
  trendingMoviesDay: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/movie/day", { page }),

  trendingTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/tv/week", { page }),

  topRated: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/movie/top_rated", { page }),

  popularTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/tv/popular", { page }),

  nowPlaying: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/movie/now_playing", { page }),

  airingToday: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/tv/airing_today", { page }),

  upcoming: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/movie/upcoming", { page }),

  netflixUpcoming: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      page,
      with_networks: 213,
      sort_by: "primary_release_date.desc",
      "primary_release_date.gte": new Date().toISOString().split("T")[0],
    }),

  /** Netflix TV titles scheduled for a future release. */
  netflixComingSoonTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      page,
      with_networks: 213,
      sort_by: "first_air_date.asc",
      "first_air_date.gte": TODAY,
      "vote_count.gte": 1,
    }),

  /**
   * Weekly trending feed requested by the New & Hot screen.
   * TMDB's trending endpoint is a global feed, so the Netflix constraint is
   * passed through for proxy/API implementations that support it; the screen
   * still limits the visible feed to TV titles with Netflix metadata.
   */
  netflixTrending: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/all/week", {
      page,
      with_networks: 213,
      region: "IN",
    }),

  onTheAir: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/tv/on_the_air", { page }),

  videos: (type: "movie" | "tv", id: number): Promise<{ results: any[] }> =>
    get<{ results: any[] }>(`/${type}/${id}/videos`, {
      include_video_language: "en,null",
    }),

  discover: (type: "movie" | "tv", genre: number, page = 1): Promise<TMDBPage> =>
    get<TMDBPage>(`/discover/${type}`, { with_genres: genre, page }),

  detail: (type: "movie" | "tv", id: number): Promise<TMDBDetail> =>
    get<TMDBDetail>(`/${type}/${id}`),

  watchProviders: (
    type: "movie" | "tv",
    id: number,
  ): Promise<{
    results?: Record<string, {
      flatrate?: Array<{ provider_id: number; provider_name: string }>;
      buy?: Array<{ provider_id: number; provider_name: string }>;
      rent?: Array<{ provider_id: number; provider_name: string }>;
    }>;
  }> => get(`/${type}/${id}/watch/providers`),

  /** GET /movie|tv/{id}/translations — used to check which audio/text
   *  languages (e.g. "hi" for Hindi) actually exist for a title. */
  translations: (type: "movie" | "tv", id: number): Promise<TMDBTranslationsResponse> =>
    get<TMDBTranslationsResponse>(`/${type}/${id}/translations`),

  seasonDetail: (tvId: number, season: number): Promise<TMDBSeasonDetail> =>
    get<TMDBSeasonDetail>(`/tv/${tvId}/season/${season}`),

  search: (query: string, page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/search/multi", { query, page }),

  trendingToday: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/all/day", { page }),

  // Uses /trending/all/day so both movies AND TV shows trending in India
  // are included — matches what Netflix India's "Top 10" actually surfaces.
  trendingMoviesIN: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/all/day", { page, region: "IN" }),

  trendingTVIN: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/tv/day", { page, region: "IN" }),

  trendingMoviesUS: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/movie/day", { page, region: "US" }),

  eastAsian: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR|JP|CN",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  awardWinningTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      "vote_average.gte": 8,
      "vote_count.gte": 200,
      sort_by: "vote_average.desc",
      page,
    }),

  usTVShows: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "US",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  popularKoreanTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  koreanDramas: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_genres: 18,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  koreanDramasIN: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      region: "IN",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  romanticKoreanComedies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_genres: "10749,35",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  asianBinge: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR|JP|CN|TH",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  blockbusters: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      sort_by: "revenue.desc",
      "vote_count.gte": 500,
      "primary_release_date.lte": TODAY,
      page,
    }),

  koreanThrillers: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_genres: "53,9648",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  scifiFantasyTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 10765,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  /** Horror TV Series — explicit horror genre (27) with sort and minimum vote
   *  threshold so the query always returns a dense, non-empty result set. */
  horrorTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 27,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  topRatedTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/tv/top_rated", { page }),

  popularMix: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/all/week", { page }),

  allTimeBest: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/movie/top_rated", {
      "vote_average.gte": 8,
      "vote_count.gte": 3000,
      page,
    }),

  netflixOriginals: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 213,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  amazonPrime: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 1024,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  disneyPlus: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 2739,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  appleTVPlus: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 2552,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  hotstar: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 3919,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  marvelMCU: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_companies: 420,
      sort_by: "primary_release_date.desc",
      "primary_release_date.lte": TODAY,
      page,
    }),

  credits: (type: "movie" | "tv", id: number): Promise<{ cast: TMDBCastMember[] }> =>
    get<{ cast: TMDBCastMember[] }>(`/${type}/${id}/credits`),

  recommendations: (type: "movie" | "tv", id: number, page = 1): Promise<TMDBPage> =>
    get<TMDBPage>(`/${type}/${id}/recommendations`, { page }),

  similar: (type: "movie" | "tv", id: number, page = 1): Promise<TMDBPage> =>
    get<TMDBPage>(`/${type}/${id}/similar`, { page }),

  mgmPlus: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 4181,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  sonyLIV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 1109,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  mxPlayer: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 3236,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  // ─── Anime (TMDB genre 16, Japanese origin) ─────────────────────────────────
  animeTrending: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 16,
      with_origin_country: "JP",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  animeMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: 16,
      with_origin_country: "JP",
      sort_by: "primary_release_date.desc",
      "primary_release_date.lte": TODAY,
      page,
    }),

  animeTopRated: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 16,
      with_origin_country: "JP",
      "vote_average.gte": 8,
      "vote_count.gte": 200,
      sort_by: "vote_average.desc",
      page,
    }),

  animeNewSeason: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 16,
      with_origin_country: "JP",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  animeAction: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "16,10759",
      with_origin_country: "JP",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  // ─── Hindi content ────────────────────────────────────────────────────────
  hindiMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_original_language: "hi",
      sort_by: "popularity.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  hindiShows: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_original_language: "hi",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  hindiThrillers: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_original_language: "hi",
      with_genres: 53,
      sort_by: "popularity.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  hindiTopRated: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_original_language: "hi",
      "vote_average.gte": 7,
      "vote_count.gte": 500,
      sort_by: "vote_average.desc",
      page,
    }),

  // ─── Web Series ────────────────────────────────────────────────────────────
  webSeriesIndia: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_original_language: "hi", sort_by: "popularity.desc", "first_air_date.lte": TODAY, "vote_count.gte": 20, page }),

  crimeWebSeries: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: "80,18", sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  thrillerWebSeries: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: "53,18", sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  actionWebSeries: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: "10759,18", sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  romanceWebSeries: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: "10749,18", sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  // ─── Manga / Manhwa ────────────────────────────────────────────────────────
  mangaAdaptations: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: 16, with_origin_country: "JP", "vote_count.gte": 300, sort_by: "vote_count.desc", page }),

  manhwaContent: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: 16, with_origin_country: "KR", sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  animeRomance: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: "16,10749", with_origin_country: "JP", sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  animeMystery: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: "16,9648", with_origin_country: "JP", sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  animeFantasy: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: "16,14", with_origin_country: "JP", sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  // ─── Sports & Live TV ──────────────────────────────────────────────────────
  sportsDocumentaries: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", { with_genres: 99, "vote_count.gte": 100, sort_by: "primary_release_date.desc", "primary_release_date.lte": TODAY, page }),

  sportsDramas: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", { with_genres: 18, "vote_average.gte": 7, "vote_count.gte": 500, sort_by: "primary_release_date.desc", "primary_release_date.lte": TODAY, page }),

  realityTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: 10764, sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  talkShows: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: 10767, sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  newsTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: 10763, sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  warPolitics: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_genres: 10768, sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  // ─── Kids / Family content ────────────────────────────────────────────────
  kidsAnimation: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: 16,
      "vote_count.gte": 50,
      sort_by: "primary_release_date.desc",
      "primary_release_date.lte": TODAY,
      page,
    }),

  familyMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: 10751,
      sort_by: "primary_release_date.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  kidsTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10762",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  animationTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 16,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  pixarAndDreamworks: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "16,10751",
      "vote_average.gte": 6.5,
      "vote_count.gte": 200,
      sort_by: "vote_average.desc",
      page,
    }),

  kidsFantasy: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "14,10751",
      sort_by: "primary_release_date.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  kidsTrending: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/movie/week", {
      with_genres: "16,10751",
      page,
    }),

  /**
   * Generic discover with arbitrary TMDb params — used by genre browser.
   * Pass any valid TMDb discover query parameters.
   */
  discoverWithParams: (
    type: "movie" | "tv" | "all",
    params: Record<string, string | number>,
    page = 1,
  ): Promise<TMDBPage> => {
    if (type === "all") {
      return get<TMDBPage>("/trending/all/week", { ...params, page });
    }
    return get<TMDBPage>(`/discover/${type}`, { ...params, page });
  },

  // ─── Named category rows ─────────────────────────────────────────────────

  /** Asian Movie & TV — origin countries JP, KR, CN, TH, IN, HK, TW */
  asianMovieTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "JP|KR|CN|TH|IN|HK|TW",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  /** Romantic International TV Shows — romance + drama genre */
  romanticInternational: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10749,18",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  /** Young Adult — coming-of-age drama & fantasy movies */
  youngAdult: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "18,14",
      "primary_release_date.gte": "2005-01-01",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 100,
      sort_by: "popularity.desc",
      page,
    }),

  /** Opposites-Attract TV Shows — romance OR comedy dramas with relationship keywords.
   *  Uses | (OR) instead of , (AND) so shows only need one matching genre,
   *  guaranteeing a dense result set. Keywords 9836 (love) | 236411 (enemies to lovers)
   *  bubble the most thematically relevant titles to the top. */
  oppositesAttract: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10749|35",
      with_keywords: "9836|236411|818",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  /** Action & Adventure TV — genre 10759 */
  actionAdventure: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 10759,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  /** Familiar Favourite Series — highly rated, universally recognised nostalgic
   *  international TV with 1 000+ votes so only proven classics surface. */
  familiarFavourites: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      sort_by: "vote_average.desc",
      "vote_average.gte": 8,
      "vote_count.gte": 1000,
      page,
    }),

  /** Your Next Watch — this week's trending TV across all genres. */
  yourNextWatch: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/tv/week", { page }),

  /** More Like "Can This Love Be Translated?" — Korean melodrama/romance. */
  moreLikeKoreanMelodrama: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_genres: "10749|18",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  /** Romantic International TV Comedies — romance OR comedy from non-US origins,
   *  lower threshold so newer international titles are included. */
  romanticIntlComedies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10749|35",
      without_origin_country: "US",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  /** Erase My Memory So I Can Watch Again — universally acclaimed twist-heavy
   *  dramas and thrillers with ≥ 8.0 rating and strong vote base. */
  eraseMyMemory: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "18|53|9648",
      sort_by: "vote_average.desc",
      "vote_average.gte": 8,
      "vote_count.gte": 500,
      page,
    }),

  /** Hollywood Movies — US-origin films sorted by popularity. */
  hollywoodMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_origin_country: "US",
      sort_by: "popularity.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 100,
      page,
    }),

  /** Celebrating Pride — LGBTQ+ themed TV content via keyword filter. */
  celebratingPride: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_keywords: "5989|13062|21175",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  /** Romantic East Asian TV Shows — KR/JP/CN romance or drama series. */
  romanticEastAsian: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR|JP|CN",
      with_genres: "10749|18",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  /** Meet Your Next Binge — high-popularity mystery & thriller TV series. */
  meetNextBinge: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "9648|53",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 100,
      page,
    }),

  /** First Love Romance — romance/drama TV with first-love keyword signals. */
  firstLoveRomance: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10749|18",
      with_keywords: "9673|14318|818",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  /** So Completely Captivating — prestige award-winning TV, offset to page 2 for variety. */
  soCompletelyCaptivating: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      sort_by: "vote_average.desc",
      "vote_average.gte": 8.0,
      "vote_count.gte": 1500,
      page: page + 1,
    }),

  /** Romantic Asian TV Shows — broad East/SE Asian romance TV. */
  romanticAsianTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR|JP|CN|TH|IN",
      with_genres: 10749,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  /** Korean Movies & TV Dubbed in Hindi — Korean content with Hindi spoken language. */
  koreanHindiContent: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_spoken_languages: "hi",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  /** K-Dramas Dubbed in Hindi — Korean drama series with Hindi audio available. */
  koreanDramasHindi: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_genres: 18,
      with_spoken_languages: "hi",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      page,
    }),

  /** US TV Comedies — US-origin comedy series. */
  usTVComedies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "US",
      with_genres: 35,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  /** Suspenseful TV Shows — thriller or mystery genre episodic series. */
  suspensefulTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "53|9648",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  /** Romantic Shows — TV series with Romance genre ID 10749. */
  romanticShows: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 10749,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  /** Latest Movies — newly released feature films sorted by release date. */
  latestMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/movie/now_playing", {
      sort_by: "primary_release_date.desc",
      page,
    }),

  /** From K-Pop to K-Dramas — South Korean shows featuring idol actors or music dramas. */
  fromKPopToKDramas: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_genres: "10402|18|35",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  /** Made in India — Hindi language and Indian-origin local content. */
  madeInIndia: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "IN",
      with_original_language: "hi|ta|te|ml|bn",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  /** Top 10 Shows in India Today — TV shows trending right now via TMDB's
   *  daily trending endpoint with Indian region filter. Updates every 24h. */
  top10TrendingShowsIndia: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/tv/day", { page, region: "IN" }),

  /** Bingeworthy TV Shows — newest highly-rated series (recent releases, not all-time). */
  bingeworthyTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_average.gte": 7.5,
      "vote_count.gte": 200,
      page,
    }),

  /** We Think You'll Love These — all-time critically acclaimed TV (hidden gems). */
  weThinkYoullLove: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      sort_by: "vote_average.desc",
      "vote_average.gte": 8.2,
      "vote_count.gte": 800,
      page,
    }),

  /** Can This Love be Translated — international cross-language romance TV shows. */
  canThisLoveBeTranslated: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10749",
      with_original_language: "ko|ja|zh|fr|es|de|it|hi",
      sort_by: "popularity.desc",
      "vote_count.gte": 30,
      page,
    }),

  /** Critically Acclaimed US TV Dramas — top-rated American drama series. */
  criticallyAcclaimedUSDramas: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "18",
      with_origin_country: "US",
      sort_by: "vote_average.desc",
      "vote_count.gte": 300,
      page,
    }),

  /** Romantic TV Shows — romance genre TV series sorted by popularity. */
  romanticTVShows: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10749",
      sort_by: "popularity.desc",
      "vote_count.gte": 50,
      page,
    }),

  /** Movies & TV Shows Dubbed in Telugu — Telugu-language content. */
  teluguContent: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_original_language: "te",
      sort_by: "popularity.desc",
      page,
    }),

  /** Swoonworthy Romance — highly-rated romance shows that make you feel all the feels. */
  swoonworthyRomance: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10749|35",
      sort_by: "vote_average.desc",
      "vote_count.gte": 80,
      page,
    }),

  /** WWE & Sports Entertainment — action-packed sports and entertainment shows. */
  wweSports: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10759|10764",
      sort_by: "popularity.desc",
      "vote_count.gte": 20,
      page,
    }),

  /** Japanese TV Shows — popular Japanese live-action and drama series. */
  japaneseTVShows: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_original_language: "ja",
      with_origin_country: "JP",
      without_genres: "16",
      sort_by: "popularity.desc",
      "vote_count.gte": 20,
      page,
    }),

  /** Crowd Pleasers — action, crime & thriller fan-favourites everyone is watching. */
  crowdPleasers: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      sort_by: "popularity.desc",
      with_genres: "10759|80|53",
      "vote_count.gte": 500,
      "vote_average.gte": 7.0,
      page,
    }),

  /** TV Sci-Fi & Horror — science fiction and horror TV series combined. */
  sciFiHorrorTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10765|27",
      sort_by: "popularity.desc",
      "vote_count.gte": 50,
      page,
    }),

  /** Get In on the Action — high-octane action and adventure TV series. */
  getInOnAction: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10759|28",
      sort_by: "popularity.desc",
      "vote_count.gte": 100,
      page,
    }),

  /** Top 10 Movies in India Today — combines daily trending (IN region) with
   *  Hindi-language popular movies so Bollywood always surfaces prominently.
   *  Merges both lists, de-duplicates, and returns top results by popularity. */
  top10MoviesIndia: async (page = 1): Promise<TMDBPage> => {
    const [trending, hindi] = await Promise.all([
      get<TMDBPage>("/trending/movie/day", { page, region: "IN" }),
      get<TMDBPage>("/discover/movie", {
        page,
        region: "IN",
        with_original_language: "hi",
        sort_by: "popularity.desc",
        "vote_count.gte": 10,
      }),
    ]);
    const seen = new Set<number>();
    const merged: typeof trending.results = [];
    for (const m of [...trending.results, ...hindi.results]) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }
    merged.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return { ...trending, results: merged.slice(0, 20) };
  },

  // ─── Home category map — additional named rows ──────────────────────────
  // Each fetcher documents its genre / keyword / origin-country mapping so the
  // category → TMDB-query relationship in lib/categoryMap.ts stays auditable.

  /** Emotional Movie — high-rated Drama (genre 18), proxy for "tearjerker" content. */
  emotionalMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: 18,
      sort_by: "vote_average.desc",
      "vote_average.gte": 7,
      "vote_count.gte": 300,
      page,
    }),

  /** Eye Candy — visually spectacular Sci-Fi (878) OR Fantasy (14) blockbusters. */
  eyeCandyMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "878|14",
      sort_by: "popularity.desc",
      "vote_count.gte": 300,
      page,
    }),

  /** Hidden Gems — high vote_average but low vote_count, so blockbusters are excluded
   *  and only lesser-known, well-reviewed movies surface. */
  hiddenGems: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      sort_by: "vote_average.desc",
      "vote_average.gte": 7.2,
      "vote_count.gte": 50,
      "vote_count.lte": 800,
      page,
    }),

  /** Popular on Stream — this week's most popular movies worldwide. */
  popularOnStream: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      sort_by: "popularity.desc",
      "vote_count.gte": 100,
      page,
    }),

  /** Mind-Bending Stories — Sci-Fi (878) AND Mystery (9648), the classic "plot twist" combo. */
  mindBendingStories: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "878,9648",
      sort_by: "popularity.desc",
      "vote_count.gte": 50,
      page,
    }),

  /** Psychological Thrillers — Thriller (53) AND Mystery (9648), keyword "psychological" (10944). */
  psychologicalThrillers: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "53,9648",
      with_keywords: "10944",
      sort_by: "popularity.desc",
      "vote_count.gte": 30,
      page,
    }),

  /** Everyone's Watching — today's single most-watched movie snapshot, global. */
  everyonesWatching: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/movie/day", { page }),

  /** Global Top Picks — this week's worldwide trending movies (broader window than "Everyone's Watching"). */
  globalTopPicks: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/movie/week", { page }),

  /** Kids & Family — Family (10751) OR Animation (16) genre movies. */
  kidsFamily: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "10751|16",
      sort_by: "popularity.desc",
      "vote_count.gte": 50,
      page,
    }),

  /** Late Night Watch — Horror (27) OR Thriller (53), the after-dark genre pairing. */
  lateNightWatch: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "27|53",
      sort_by: "popularity.desc",
      "vote_count.gte": 100,
      page,
    }),

  /** IMDb Top Rated — proxy using TMDB's own all-time top-rated movie list. */
  imdbTopRated: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/movie/top_rated", { page }),

  /** Leaving Soon — TMDB has no real "expiring" flag, so this is an honest proxy:
   *  well-rated older catalog titles (5–15 years old) rather than brand-new releases,
   *  the closest legitimate signal for "library titles that might rotate out". */
  leavingSoon: (page = 1): Promise<TMDBPage> => {
    const now = new Date();
    const oldEnd = `${now.getFullYear() - 5}-12-31`;
    const oldStart = `${now.getFullYear() - 15}-01-01`;
    return get<TMDBPage>("/discover/movie", {
      sort_by: "vote_average.desc",
      "vote_average.gte": 6.5,
      "vote_count.gte": 200,
      "primary_release_date.gte": oldStart,
      "primary_release_date.lte": oldEnd,
      page,
    });
  },

  /** Because you liked — Korean romance & melodrama, personalisation proxy. */
  becauseYouLiked: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_genres: "10749|18|35",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 50,
      page,
    }),

  /** Because You Watched — this week's trending TV (personalisation proxy). */
  becauseYouWatched: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/trending/tv/week", { page: page + 1 }),

  /** Dreams to you — romantic + fantasy TV shows, ethereal & emotional. */
  dreamsToYou: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: "10749|14",
      sort_by: "vote_average.desc",
      "vote_average.gte": 7.5,
      "vote_count.gte": 50,
      "first_air_date.lte": TODAY,
      page,
    }),

  /** Only On Netflix shows — content from Netflix network (TMDB network ID 213). */
  onlyOnNetflix: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 213,
      sort_by: "popularity.desc",
      "vote_count.gte": 50,
      page,
    }),

  /** Get In on the Action (movies) — action & adventure feature films. */
  actionAdventureMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "28|12",
      sort_by: "popularity.desc",
      "vote_count.gte": 100,
      "primary_release_date.lte": TODAY,
      page,
    }),

  /** Top 5 show by Netflix Korean — Korean originals on Netflix by popularity. */
  top5NetflixKorean: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 213,
      with_origin_country: "KR",
      sort_by: "popularity.desc",
      "vote_count.gte": 30,
      page,
    }),

  /**
   * Only On S-Movie Original — prestige titles curated exclusively for this
   * platform: high-rated, recent, award-quality films that feel "originals-tier".
   */
  onlyOnSMovie: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      sort_by: "vote_average.desc",
      "vote_average.gte": 7.8,
      "vote_count.gte": 500,
      "primary_release_date.gte": `${new Date().getFullYear() - 4}-01-01`,
      "primary_release_date.lte": TODAY,
      page,
    }),

  /**
   * Personalised fetcher — returns content matching the user's top genre IDs.
   * Call as: tmdb.personalizedByGenres([10749, 18], "tv")(page)
   * Used by the "Top Picks For You" / "Your [Genre] Picks" row.
   */
  personalizedByGenres: (
    genreIds:  number[],
    mediaType: "movie" | "tv" = "movie",
  ) => (page = 1): Promise<TMDBPage> => {
    if (genreIds.length === 0) {
      // Cold start — fall back to weekly trending
      return mediaType === "tv"
        ? get<TMDBPage>("/trending/tv/week", { page })
        : get<TMDBPage>("/trending/movie/week", { page });
    }
    const endpoint = mediaType === "tv" ? "/discover/tv" : "/discover/movie";
    const genreStr = genreIds.slice(0, 3).join("|"); // OR logic — any matching genre
    const dateKey  = mediaType === "tv" ? "first_air_date.lte" : "primary_release_date.lte";
    const params: Record<string, string | number> = {
      with_genres:        genreStr,
      sort_by:            "vote_average.desc",
      "vote_average.gte": 7.0,
      "vote_count.gte":   50,
      page,
    };
    params[dateKey] = TODAY;
    return get<TMDBPage>(endpoint, params);
  },

  /**
   * Top 10 Movie in India Today — STRICTLY Netflix content (network 213) in India.
   * Merges Netflix movies (via watch provider) and Netflix TV (via network) for variety,
   * sorted by popularity so the most-watched titles surface first.
   */
  top10NetflixIndia: async (page = 1): Promise<TMDBPage> => {
    const [movies, shows] = await Promise.all([
      get<TMDBPage>("/discover/movie", {
        with_watch_providers: 8,   // Netflix watch provider ID
        watch_region: "IN",
        sort_by: "popularity.desc",
        "primary_release_date.lte": TODAY,
        "vote_count.gte": 10,
        page,
      }),
      get<TMDBPage>("/discover/tv", {
        with_networks: 213,         // Netflix network ID
        sort_by: "popularity.desc",
        "first_air_date.lte": TODAY,
        "vote_count.gte": 20,
        page,
      }),
    ]);
    const seen = new Set<number>();
    const merged: typeof movies.results = [];
    for (const m of [...movies.results, ...shows.results]) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }
    merged.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return { ...movies, results: merged.slice(0, 20) };
  },

  // ─── New category fetchers (90-row expansion) ────────────────────────────────

  /** Made in Korea — all Korean-origin TV, sorted by popularity. */
  madeInKorea: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  /** New on Netflix — Netflix originals sorted by air date (most recent first). */
  newOnNetflix: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_networks: 213,
      sort_by: "first_air_date.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 10,
      page,
    }),

  /** Asian TV Shows — broad East/SE Asian TV (KR, JP, CN, TH, HK, TW, IN). */
  asianTVShows: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR|JP|CN|TH|HK|TW|IN",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  /** Korean TV Action & Adventure — KR-origin action/adventure series. */
  koreanActionTV: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_origin_country: "KR",
      with_genres: 10759,
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  /** Anime Series — top-rated Japanese animation TV, separate pool from trending. */
  animeSeries: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_genres: 16,
      with_origin_country: "JP",
      sort_by: "vote_average.desc",
      "vote_average.gte": 7.5,
      "vote_count.gte": 100,
      "first_air_date.lte": TODAY,
      page,
    }),

  /** Indian Movies — Hindi-language feature films sorted by popularity. */
  indianMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_original_language: "hi",
      sort_by: "popularity.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 20,
      page,
    }),

  /** Romantic Indian Movies — Hindi romance feature films. */
  romanticIndianMovies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_original_language: "hi",
      with_genres: 10749,
      sort_by: "popularity.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 10,
      page,
    }),

  /** Desi & Chill — relaxed Hindi-language TV drama for casual viewing. */
  desiAndChill: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", {
      with_original_language: "hi",
      sort_by: "popularity.desc",
      "first_air_date.lte": TODAY,
      "vote_count.gte": 10,
      page,
    }),

  /** Romantic Comedies — romcom movies (romance + comedy genre pairing). */
  romanticComedies: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_genres: "10749,35",
      sort_by: "popularity.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 100,
      page,
    }),

  /** US Movies dubbed in Hindi — English-language films with Hindi spoken audio. */
  usMoviesDubbedInHindi: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/movie", {
      with_original_language: "en",
      with_spoken_languages: "hi",
      sort_by: "popularity.desc",
      "primary_release_date.lte": TODAY,
      "vote_count.gte": 30,
      page,
    }),

  /** Top 10 Shows in All Country Today — Netflix TV globally, sorted by popularity. */
  top10ShowsAllCountries: (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>("/discover/tv", { with_networks: 213, sort_by: "popularity.desc", "first_air_date.lte": TODAY, page }),

  // ─── Netflix-Only Generic Fetchers (with_networks=213 / watch_provider=8) ────
  // These replace the open-catalog fetchers in categoryMap.ts so every row
  // exclusively shows Netflix content, as specified by the permanent algorithm.

  /**
   * Generic Netflix TV discover — with_networks=213 plus any extra params.
   * Usage: tmdb.netflixTV({ with_genres: "10749,18" })(page)
   */
  netflixTV: (extra: Record<string, string | number> = {}) =>
    (page = 1): Promise<TMDBPage> =>
      get<TMDBPage>("/discover/tv", {
        with_networks: NETFLIX_NETWORK_ID,
        sort_by: "popularity.desc",
        "first_air_date.lte": TODAY,
        "vote_count.gte": 5,
        ...extra,
        page,
      }),

  /**
   * Generic Netflix Movie discover — with_watch_providers=8 (Netflix) plus extra params.
   * Usage: tmdb.netflixMovie({ with_genres: 28 })(page)
   */
  netflixMovie: (extra: Record<string, string | number> = {}) =>
    (page = 1): Promise<TMDBPage> =>
      get<TMDBPage>("/discover/movie", {
        with_watch_providers: 8,
        watch_region: "IN",
        sort_by: "popularity.desc",
        "primary_release_date.lte": TODAY,
        "vote_count.gte": 5,
        ...extra,
        page,
      }),

  /**
   * Netflix New Releases — combines newest Netflix TV series + movies sorted by
   * release date descending. Used exclusively for the Hero Banner so it always
   * shows the freshest Netflix content with the 15-hour poster rotation.
   */
  netflixNewReleasesAll: async (page = 1): Promise<TMDBPage> => {
    const [tv, movies] = await Promise.all([
      get<TMDBPage>("/discover/tv", {
        with_networks: NETFLIX_NETWORK_ID,
        sort_by: "first_air_date.desc",
        "first_air_date.lte": TODAY,
        "vote_count.gte": 5,
        page,
      }),
      get<TMDBPage>("/discover/movie", {
        with_watch_providers: 8,
        watch_region: "IN",
        sort_by: "primary_release_date.desc",
        "primary_release_date.lte": TODAY,
        "vote_count.gte": 5,
        page,
      }),
    ]);
    const tvR     = (tv.results    ?? []).map((m) => ({ ...m, media_type: "tv"    }));
    const movieR  = (movies.results ?? []).map((m) => ({ ...m, media_type: "movie" }));
    const merged  = [...tvR, ...movieR].sort((a, b) => {
      const aD = a.first_air_date ?? (a as any).release_date ?? "";
      const bD = b.first_air_date ?? (b as any).release_date ?? "";
      return bD.localeCompare(aD);
    });
    const seen = new Set<number>();
    const unique = merged.filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
    return { ...tv, results: unique.slice(0, 40) };
  },

  /**
   * TV Recommendations factory — returns a standard (page) fetcher bound to a
   * specific TMDB TV show ID's /recommendations endpoint. Used for "Because You
   * Watched …" and named show rows (Goblin, Sweet Home, Lovely Runner, etc.).
   * Falls back gracefully: if the title has no recommendations, the row collapses.
   */
  tvRecommendations: (tvId: number) => (page = 1): Promise<TMDBPage> =>
    get<TMDBPage>(`/tv/${tvId}/recommendations`, { page }),

  /**
   * TMDB curated list by list ID — /3/list/{id}
   * Wraps the list response into the standard TMDBPage shape.
   */
  list: async (listId: number, page = 1): Promise<TMDBPage> => {
    const data = await get<{ items?: TMDBMovie[]; results?: TMDBMovie[]; total_results?: number; total_pages?: number }>(
      `/list/${listId}`,
      { page },
    );
    const results = data.items ?? data.results ?? [];
    return {
      results,
      page,
      total_pages: data.total_pages ?? 1,
      total_results: data.total_results ?? results.length,
    };
  },
};

/**
 * Proxy-aware TMDB fetch — routes through the server proxy first, falls back
 * to direct api.themoviedb.org. Use this in any file that previously made its
 * own direct TMDB fetch calls, to keep all API calls consolidated here.
 */
export async function tmdbGet<T = unknown>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  return get<T>(path, params);
}

export function tmdbToCard(m: TMDBMovie): {
  id: string;
  title: string;
  poster: { uri: string } | null;
  hero: { uri: string } | null;
  rating: string;
  genres: string[];
  year: number;
  synopsis: string;
  tmdbRating: number;
  tmdbId: number;
  mediaType: "movie" | "tv";
} {
  const posterUrl = tmdbImg(m.poster_path, "w342");
  const heroUrl = tmdbImg(m.backdrop_path, "w780");
  const title = m.title ?? m.name ?? "Untitled";
  const genres = (m.genre_ids ?? [])
    .slice(0, 3)
    .map((id) => GENRE_MAP[id] ?? "")
    .filter(Boolean);
  const year = parseInt(
    (m.release_date ?? m.first_air_date ?? "2024").slice(0, 4),
  );
  const mediaType: "movie" | "tv" =
    m.media_type === "tv" || (m.media_type !== "movie" && m.name) ? "tv" : "movie";
  return {
    id: `tmdb-${m.id}`,
    title,
    poster: posterUrl ? { uri: posterUrl } : null,
    hero: heroUrl ? { uri: heroUrl } : null,
    rating: "TV-MA",
    genres,
    year,
    synopsis: m.overview,
    tmdbRating: Math.round(m.vote_average * 10) / 10,
    tmdbId: m.id,
    mediaType,
  };
}
