import { Router, type IRouter } from "express";

const router: IRouter = Router();
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_HOST = "image.tmdb.org";
const TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342";
const TMDB_BACKDROP_BASE_URL = "https://image.tmdb.org/t/p/w780";

type TmdbImageResult = {
  poster_path?: string | null;
  backdrop_path?: string | null;
  [key: string]: unknown;
};

function addImageUrls(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;

  const addUrls = (result: TmdbImageResult): TmdbImageResult => ({
    ...result,
    poster_url: result.poster_path
      ? `${TMDB_POSTER_BASE_URL}${result.poster_path}`
      : null,
    backdrop_url: result.backdrop_path
      ? `${TMDB_BACKDROP_BASE_URL}${result.backdrop_path}`
      : null,
  });

  const payload = value as Record<string, unknown>;
  const transformed: Record<string, unknown> = { ...payload };
  if ("poster_path" in payload || "backdrop_path" in payload) {
    Object.assign(transformed, addUrls(payload as TmdbImageResult));
  }
  if (Array.isArray(payload.results)) {
    transformed.results = payload.results.map((result) =>
      result && typeof result === "object"
        ? addUrls(result as TmdbImageResult)
        : result,
    );
  }
  return transformed;
}

/**
 * Stream TMDB artwork through the API server. The client uses this route as
 * its first-party image URL so poster requests do not depend on ISP access to
 * image.tmdb.org.
 */
router.get("/image", async (req, res) => {
  const rawUrl = req.query.url;
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    res.status(400).json({ error: "An image URL is required." });
    return;
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid image URL." });
    return;
  }

  if (target.protocol !== "https:" || target.hostname !== TMDB_IMAGE_HOST) {
    res.status(400).json({ error: "Only TMDB image URLs are allowed." });
    return;
  }

  try {
    const response = await fetch(target, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      res.status(response.status).send("TMDB image unavailable.");
      return;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const body = Buffer.from(await response.arrayBuffer());
    req.log.info({
      tag: "[IMAGE_PROXY]",
      status: response.status,
      endpoint: rawUrl,
      contentType,
      bytes: body.length,
    }, "TMDB image proxy response");
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    });
    res.send(body);
  } catch (error) {
    req.log.error({ err: error }, "TMDB image proxy request failed");
    res.status(502).send("TMDB image temporarily unavailable.");
  }
});

/**
 * Server-side TMDB proxy.
 *
 * The mobile bundle never receives TMDB_API_KEY. Only the API server reads the
 * secret and forwards the allow-listed TMDB path/query to TMDB.
 */
router.use("/tmdb", async (req, res) => {
  const apiKey = process.env.TMDB_API_KEY;
  const endpoint = req.path;

  if (!apiKey) {
    req.log.error({ tag: "[TMDB]", endpoint }, "TMDB_API_KEY is missing on the API server");
    res.status(503).json({ error: "TMDB is not configured on the API server." });
    return;
  }

  if (!endpoint.startsWith("/") || endpoint.includes("..") || endpoint.includes("//")) {
    res.status(400).json({ error: "Invalid TMDB endpoint." });
    return;
  }

  const target = new URL(`${TMDB_BASE_URL}${endpoint}`);
  target.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === "string") target.searchParams.set(key, value);
  }

  try {
    const response = await fetch(target, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text();
    if (!response.ok) {
      req.log.error({
        tag: "[TMDB ERROR]",
        status: response.status,
        endpoint,
        responseError: body,
      }, "TMDB upstream request failed");
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Preserve the upstream response body and status even when it is not JSON.
    }
    const transformed = addImageUrls(parsed);
    const transformedBody = parsed === null ? body : JSON.stringify(transformed);
    const results = transformed && typeof transformed === "object" &&
      Array.isArray((transformed as { results?: unknown }).results)
      ? (transformed as { results: Array<{ id?: number; poster_path?: string | null; poster_url?: string | null }> }).results
      : [];
    const first = results[0];
    req.log.info({
      tag: "[TMDB]",
      status: response.status,
      endpoint,
      resultCount: results.length,
      firstResultId: first?.id ?? null,
      firstPosterPath: first?.poster_path ?? null,
      generatedPosterUrl: first?.poster_url ?? null,
    }, "TMDB response");
    res.status(response.status);
    res.type(response.headers.get("content-type") ?? "application/json");
    res.send(transformedBody);
  } catch (error) {
    req.log.error({ err: error, endpoint }, "TMDB proxy request failed");
    res.status(502).json({ error: "TMDB is temporarily unavailable." });
  }
});

export default router;