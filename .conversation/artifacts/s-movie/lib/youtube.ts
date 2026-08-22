// Single Google API key — same key covers YouTube Data API v3
const YT_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_API_KEY ??
  process.env.EXPO_PUBLIC_YOUTUBE_API_KEY ??
  "";

/**
 * Search YouTube Data API v3 for an official English trailer.
 * Returns null if the API key is missing, the network fails, or no results are found.
 */
export async function searchYouTubeTrailer(
  title: string,
  year?: string | number | null,
): Promise<string | null> {
  if (!YT_API_KEY) return null;

  const query = year
    ? `${title} ${year} official trailer`
    : `${title} official trailer`;

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("key", YT_API_KEY);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const items: Array<{ id: { videoId?: string }; snippet: { title: string } }> =
      data?.items ?? [];

    const best =
      items.find((item) =>
        item.snippet.title.toLowerCase().includes("trailer"),
      ) ?? items[0];

    return best?.id?.videoId ?? null;
  } catch {
    return null;
  }
}

/**
 * Search YouTube Data API v3 specifically for a Hindi trailer.
 * Tries multiple Hindi-specific queries in priority order.
 * Returns null if the API key is missing or nothing is found.
 */
export async function searchHindiTrailer(
  title: string,
  year?: string | number | null,
): Promise<string | null> {
  if (!YT_API_KEY) return null;

  const queries = [
    year ? `${title} ${year} official hindi trailer` : `${title} official hindi trailer`,
    `${title} hindi dubbed trailer`,
    `${title} hindi teaser`,
    `${title} hindi promo`,
  ];

  for (const query of queries) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("q", query);
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("maxResults", "5");
    url.searchParams.set("relevanceLanguage", "hi");
    url.searchParams.set("key", YT_API_KEY);

    try {
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const data = await res.json();
      const items: Array<{ id: { videoId?: string }; snippet: { title: string } }> =
        data?.items ?? [];

      const best =
        items.find((item) => {
          const t = item.snippet.title.toLowerCase();
          return t.includes("hindi") && t.includes("trailer");
        }) ??
        items.find((item) => item.snippet.title.toLowerCase().includes("hindi")) ??
        items.find((item) => item.snippet.title.toLowerCase().includes("trailer"));

      if (best?.id?.videoId) return best.id.videoId;
    } catch {
      continue;
    }
  }

  return null;
}
