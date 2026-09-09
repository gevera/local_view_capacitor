import "phoenix_html";
import {Socket} from "phoenix";
import {LiveSocket} from "phoenix_live_view";
import {LLVEngine} from "local_live_view";
import {startReportStore} from "./report_store.js";
import {registerOffline} from "./offline.js";
import {startReportRealtime} from "./report_realtime.js";
import {isNativePlatform} from "./native_platform.js";
import {mountSyncSettings} from "./sync_settings.js";

const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || "";
const liveSocket = new LiveSocket("/live", Socket, {params: {_csrf_token: csrfToken}});
window.liveSocket = liveSocket;

try {
  const engine = await LLVEngine.create(liveSocket, {bundlePaths: ["/assets/js/wasm/bundle.avm"]});
  const store = await startReportStore(engine);
  startReportRealtime(store);
  mountSyncSettings(store);
  if (isNativePlatform()) {
    // Hostless Capacitor shell: LocalLiveView runs without a Phoenix LiveView host.
    if (store) {
      store.offlineReady = true;
      await store.snapshot();
    }
  } else {
    liveSocket.connect();
    void registerOffline(store);
  }
} catch (error) {
  console.error("LocalLiveView could not start", error);
  const message = document.createElement("p");
  message.className = "alert";
  message.setAttribute("role", "alert");
  message.textContent = "The local runtime could not start. Reconnect and reload using a browser with WebAssembly and site storage enabled.";
  document.querySelector("main")?.append(message);
}
