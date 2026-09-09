import {Capacitor} from "@capacitor/core";

const SYNC_BASE_URL_KEY = "syncBaseUrl";

export function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch (_) {
    return false;
  }
}

export function getSyncBaseUrl() {
  const raw = (globalThis.localStorage?.getItem(SYNC_BASE_URL_KEY) || "").trim();
  return normalizeSyncBaseUrl(raw);
}

export function setSyncBaseUrl(url) {
  const normalized = normalizeSyncBaseUrl(url);
  if (!normalized) {
    globalThis.localStorage?.removeItem(SYNC_BASE_URL_KEY);
    return "";
  }
  globalThis.localStorage?.setItem(SYNC_BASE_URL_KEY, normalized);
  return normalized;
}

export function normalizeSyncBaseUrl(url) {
  const trimmed = (url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, ""));
  } catch (_) {
    return "";
  }
}

export function mobileReportsUrl(baseUrl = getSyncBaseUrl()) {
  if (!baseUrl) return "";
  return `${baseUrl}/api/mobile/v1/reports`;
}

export function reportsSocketUrl(baseUrl = getSyncBaseUrl()) {
  if (!baseUrl) return "";
  return `${baseUrl}/reports_socket`;
}
