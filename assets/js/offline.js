import {isNativePlatform} from "./native_platform.js";

export async function registerOffline(store) {
  if (isNativePlatform()) return;
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", {updateViaCache: "none"});
    await navigator.serviceWorker.ready;
    if (store) {
      store.offlineReady = true;
      await store.snapshot();
    }
  } catch (error) {
    console.error("Offline shell could not be installed", error);
    if (store) {
      store.error = "Reports are saved locally, but offline reload is not ready. Reconnect and reload to finish downloading the app.";
      await store.snapshot();
    }
  }
}
