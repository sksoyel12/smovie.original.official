import { Platform } from "react-native";
import { listDownloads } from "./downloads";

export interface StorageInfo {
  usedBytes: number;
  freeBytes: number;
  totalBytes: number;
  usedMB: number;
  usedGB: number;
  freeMB: number;
  freeGB: number;
  usedFraction: number;
  downloadCount: number;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export async function getStorageInfo(): Promise<StorageInfo> {
  const downloads = await listDownloads();

  const usedBytes = downloads.reduce((sum, d) => sum + (d.sizeBytes ?? 0), 0);
  const downloadCount = downloads.length;

  // On web, we can't query real device storage — use a fixed 32 GB device simulation
  // On native, expo-file-system v19 doesn't expose free space in the new API.
  // We simulate a 16 GB internal storage (typical mid-range device).
  const totalBytes = 16 * GB;
  const systemUsedBytes = Math.round(totalBytes * 0.42); // ~42% used by OS/apps
  const freeBytes = Math.max(0, totalBytes - systemUsedBytes - usedBytes);

  return {
    usedBytes,
    freeBytes,
    totalBytes,
    usedMB: usedBytes / MB,
    usedGB: usedBytes / GB,
    freeMB: freeBytes / MB,
    freeGB: freeBytes / GB,
    usedFraction: usedBytes / totalBytes,
    downloadCount,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 MB";
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function formatGB(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`;
}
