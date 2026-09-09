import {test} from "node:test";
import assert from "node:assert/strict";
import {
  isNativePlatform,
  mobileReportsUrl,
  normalizeSyncBaseUrl,
  reportsSocketUrl
} from "../../assets/js/native_platform.js";

test("isNativePlatform uses the Capacitor global when present", () => {
  const previous = globalThis.Capacitor;
  globalThis.Capacitor = {isNativePlatform: () => true};
  assert.equal(isNativePlatform(), true);
  globalThis.Capacitor = {isNativePlatform: () => false};
  assert.equal(isNativePlatform(), false);
  delete globalThis.Capacitor;
  assert.equal(isNativePlatform(), false);
  globalThis.Capacitor = previous;
});

test("normalizeSyncBaseUrl trims trailing slashes and rejects bad schemes", () => {
  assert.equal(normalizeSyncBaseUrl(" https://reports.example.com/ "), "https://reports.example.com");
  assert.equal(normalizeSyncBaseUrl("https://reports.example.com/app/"), "https://reports.example.com/app");
  assert.equal(normalizeSyncBaseUrl("ftp://example.com"), "");
  assert.equal(normalizeSyncBaseUrl("not a url"), "");
  assert.equal(normalizeSyncBaseUrl(""), "");
});

test("mobile sync and socket URLs are derived from the base URL", () => {
  assert.equal(mobileReportsUrl("https://reports.example.com"), "https://reports.example.com/api/mobile/v1/reports");
  assert.equal(reportsSocketUrl("https://reports.example.com"), "https://reports.example.com/reports_socket");
  assert.equal(mobileReportsUrl(""), "");
  assert.equal(reportsSocketUrl(""), "");
});
