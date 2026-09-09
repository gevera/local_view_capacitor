import "phoenix_html";
import {Socket} from "phoenix";
import {LiveSocket} from "phoenix_live_view";
import {LLVEngine} from "local_live_view";
import {startReportStore} from "./report_store.js";
import {registerOffline} from "./offline.js";
import {startReportRealtime} from "./report_realtime.js";
import {isNativePlatform} from "./native_platform.js";
import {mountSyncSettings} from "./sync_settings.js";
import {mountReportsFallbackUI} from "./reports_fallback_ui.js";

const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || "";
const liveSocket = new LiveSocket("/live", Socket, {params: {_csrf_token: csrfToken}});
window.liveSocket = liveSocket;

function canBootLocalLiveView() {
  // AtomVM needs SharedArrayBuffer (WASM threads). Android WebView cannot enable
  // cross-origin isolation, so Capacitor must use the HTML fallback UI.
  return typeof SharedArrayBuffer !== "undefined";
}

function showBootError(error) {
  console.error("LocalLiveView could not start", error);
  const message = document.createElement("p");
  message.className = "alert";
  message.setAttribute("role", "alert");
  message.textContent =
    error?.message ||
    "The local runtime could not start. Reconnect and reload using a browser with WebAssembly and site storage enabled.";
  document.querySelector("main")?.append(message);
}

async function bootNativeFallback() {
  const store = await startReportStore(null, {
    notify: async () => {}
  });
  if (!store) {
    showBootError(new Error("Browser storage is unavailable on this device."));
    return;
  }
  mountReportsFallbackUI(store);
  mountSyncSettings(store);
  store.offlineReady = true;
  startReportRealtime(store);
  await store.snapshot();
}

async function bootBrowserLocalLiveView() {
  const engine = await LLVEngine.create(liveSocket, {bundlePaths: ["/assets/js/wasm/bundle.avm"]});
  const store = await startReportStore(engine);
  startReportRealtime(store);
  liveSocket.connect();
  void registerOffline(store);
}

async function boot() {
  if (isNativePlatform() || !canBootLocalLiveView()) {
    await bootNativeFallback();
    return;
  }

  try {
    await bootBrowserLocalLiveView();
  } catch (error) {
    showBootError(error);
  }
}

boot().catch(error => {
  showBootError(error);
});
