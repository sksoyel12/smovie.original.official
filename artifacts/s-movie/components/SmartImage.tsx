/**
 * SmartImage — ISP-bypass robust image loader (speed-optimised)
 *
 * Problem: image.tmdb.org is DNS-blocked on Indian ISPs (BSNL, Airtel, Jio).
 *
 * Retry chain for TMDB artwork:
 *   1. /api/image      ← Replit server proxy with the complete encoded TMDB URL
 *   2. All failed → placeholder
 *
 * Each attempt gets 2.5s before stepping to the next.
 * expo-image's disk cache keeps successfully loaded images available across
 * app restarts and offline sessions.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image, type ImageContentFit, type ImageSource } from "expo-image";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Image as RNImage, StyleSheet, Text, View } from "react-native";
import { API_HOST } from "@/lib/apiBase";

// Blurhash placeholder shown while image loads
const BLURHASH = "L02Yr=xuofj[~qj[ofj[M{j[M{j[";

// ─── Proxy hosts ──────────────────────────────────────────────────────────────
const _API_HOST = API_HOST;
const SERVER_PROXY: string | null = _API_HOST ? `${_API_HOST}/api/image?url=` : null;

function buildProxyUrl(directTmdbUrl: string, proxy: string, size: string): string {
  const sized = directTmdbUrl.includes("/t/p/")
    ? directTmdbUrl.replace(/\/t\/p\/[^/]+\//, `/t/p/${size}/`)
    : directTmdbUrl;
  return proxy ? `${proxy}${encodeURIComponent(sized)}` : sized;
}

function getRequestedSize(directTmdbUrl: string): "w342" | "w500" | "w780" | "w1280" {
  const match = directTmdbUrl.match(/\/t\/p\/(w342|w500|w780|w1280)\//);
  if (match?.[1] === "w1280") return "w1280";
  if (match?.[1] === "w780") return "w780";
  if (match?.[1] === "w500") return "w500";
  return "w342";
}

// 3 s per step — enough for server proxy cold-start round-trip
const STEP_TIMEOUT_MS = 3_000;

// ─── URI normalisation ────────────────────────────────────────────────────────
function extractDirectUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  // Already a wsrv / weserv proxied URL — decode inner URL
  if (raw.includes("wsrv.nl") || raw.includes("weserv.nl")) {
    const m = raw.match(/[?&]url=([^&]+)/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch {}
    }
    return raw;
  }

  // Server proxy URL — extract the inner url= param
  if (raw.includes("/api/image?url=")) {
    const m = raw.match(/\/api\/image\?url=([^&]+)/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch {}
    }
    return raw;
  }

  // Bare TMDB path like /abc123.jpg
  if (raw.startsWith("/")) return `https://image.tmdb.org/t/p/w342${raw}`;

  // Direct image.tmdb.org URL
  if (raw.includes("image.tmdb.org")) return raw;

  // http → https
  if (raw.startsWith("http://")) return raw.replace("http://", "https://");

  return raw;
}

function buildAttemptUrls(rawUri: string | undefined, directUrl: string | undefined): string[] {
  if (!directUrl) return rawUri ? [rawUri] : [];

  const urls: string[] = [];
  const isTmdb = directUrl.includes("image.tmdb.org");

  // TMDB artwork must try the first-party Replit proxy before the CDN. This
  // avoids relying on direct image.tmdb.org access on restricted networks.
  if (SERVER_PROXY && isTmdb) {
    urls.push(buildProxyUrl(directUrl, SERVER_PROXY, getRequestedSize(directUrl)));
  }

  // Preserve the original URL for non-TMDB assets. TMDB artwork must stay
  // behind the first-party image proxy.
  if (!isTmdb && (rawUri?.startsWith("http://") || rawUri?.startsWith("https://"))) {
    urls.push(rawUri);
  }
  return [...new Set(urls)];
}

// ─── Shimmer ──────────────────────────────────────────────────────────────────
function Shimmer({ style }: { style?: any }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, []);
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.65] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, sh.shimmer, style, { opacity }]} />
  );
}
const sh = StyleSheet.create({ shimmer: { backgroundColor: "#1e2a3a" } });

// ─── SmartImage ───────────────────────────────────────────────────────────────
interface Props {
  source: ImageSource | string | number | null | undefined;
  style?: any;
  contentFit?: ImageContentFit;
  contentPosition?: any;
  transition?: number;
  recyclingKey?: string;
  cachePolicy?: "none" | "disk" | "memory" | "memory-disk";
  priority?: "low" | "normal" | "high";
  title?: string;
}

export default function SmartImage({
  source,
  style,
  contentFit = "cover",
  contentPosition,
  transition = 250,
  recyclingKey,
  cachePolicy = "disk",
  priority = "normal",
  title,
}: Props) {
  const rawUri =
    typeof source === "object" && source !== null && "uri" in source
      ? (source as { uri?: string }).uri
      : typeof source === "string"
      ? source
      : typeof source === "number"
      ? RNImage.resolveAssetSource(source)?.uri
      : undefined;

  const directUrl = extractDirectUrl(rawUri);
  const isTmdb = Boolean(directUrl?.includes("image.tmdb.org"));
  const attemptUrls = buildAttemptUrls(rawUri, directUrl);

  const [step, setStep] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUri = attemptUrls[step] ?? directUrl;

  // Reset whenever the source changes
  useEffect(() => {
    setStep(0);
    setLoadFailed(false);
    setIsLoading(true);
  }, [directUrl]);

  const handleError = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const nextStep = step + 1;
    if (nextStep < attemptUrls.length) {
      setStep(nextStep);
      setIsLoading(true);
    } else {
      setLoadFailed(true);
      setIsLoading(false);
    }
  }, [attemptUrls.length, currentUri, isTmdb, step]);

  const handleLoad = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsLoading(false);
  }, []);

  // Per-step timeout: advance through the proxy chain when a request stalls.
  useEffect(() => {
    if (loadFailed || !isLoading || !directUrl) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => handleError(), STEP_TIMEOUT_MS);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  // handleError is stable (useCallback + no deps that change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, directUrl, loadFailed]);

  // No usable URI at all — show a useful fallback rather than a blank card.
  if (!directUrl || !currentUri) {
    return (
      <View style={[styles.wrap, styles.failBg, styles.failCenter, style]}>
        <Ionicons name="film-outline" size={26} color="#526274" />
        {title ? <Text style={styles.failTitle} numberOfLines={2}>{title}</Text> : null}
      </View>
    );
  }

  if (loadFailed) {
    return (
      <View style={[styles.wrap, styles.failBg, styles.failCenter, style]}>
        <Ionicons name="film-outline" size={26} color="#526274" />
        {title ? <Text style={styles.failTitle} numberOfLines={2}>{title}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      {isLoading && <Shimmer />}
      <Image
        source={{ uri: currentUri }}
        placeholder={{ blurhash: BLURHASH }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        contentPosition={contentPosition}
        transition={isLoading ? 0 : transition}
        cachePolicy={cachePolicy}
        recyclingKey={recyclingKey ?? currentUri}
        priority={priority}
        onLoad={handleLoad}
        onError={handleError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:       { overflow: "hidden", backgroundColor: "#0f1923" },
  failBg:     { backgroundColor: "#111820" },
  failCenter: { justifyContent: "center", alignItems: "center", gap: 6 },
  failTitle:  { color: "#b6c3d1", fontSize: 11, lineHeight: 15, textAlign: "center", paddingHorizontal: 8, fontFamily: "Inter_600SemiBold" },
});

// ─── Prefetch utility ─────────────────────────────────────────────────────────
/**
 * Prefetch a list of image URIs using the first SmartImage attempt.
 * Call after data loads to warm the Cloudflare edge cache before the user scrolls.
 */
export async function prefetchImages(uris: (string | undefined | null)[]): Promise<void> {
  const valid = uris.filter(Boolean) as string[];
  await Promise.allSettled(
    valid.map((uri) => {
      const direct = extractDirectUrl(uri);
      const firstAttempt = buildAttemptUrls(uri, direct)[0] ?? uri;
      return Image.prefetch(firstAttempt);
    }),
  );
}

/**
 * Normalise any raw image URI to a direct source URL.
 * Exported for components that build their own `{ uri }` sources.
 */
export function normaliseImageUri(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const direct = extractDirectUrl(raw);
  if (!direct) return undefined;
  return direct;
}

/** @deprecated use normaliseImageUri */
export const normaliseUri = normaliseImageUri;
