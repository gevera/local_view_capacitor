import {Socket} from "phoenix";
import {getSyncBaseUrl, isNativePlatform, reportsSocketUrl} from "./native_platform.js";

// A separate channel also works after the cached, hostless offline page boots.
export function startReportRealtime(store) {
  if (!store) return;

  let socket;
  let channel;

  const disconnect = () => {
    socket?.disconnect();
    socket = null;
    channel = null;
  };

  const connect = () => {
    disconnect();
    const endpoint = isNativePlatform() ? reportsSocketUrl() : "/reports_socket";
    if (isNativePlatform() && !endpoint) return;

    socket = new Socket(endpoint);
    channel = socket.channel("reports:all", {});
    channel.on("report_changed", ({report}) => {
      void store.receiveReports([report]).catch(error => {
        console.error("Could not persist a realtime report update", error);
      });
    });
    // Subscribe before fetching: version-aware merging handles messages arriving
    // during the catch-up request, including after a websocket-only interruption.
    channel.join().receive("ok", () => void store.requestSync());
    socket.connect();
  };

  connect();
  window.addEventListener("offline", disconnect);
  window.addEventListener("online", connect);
  window.addEventListener("sync-base-url-changed", () => {
    if (!isNativePlatform()) return;
    if (getSyncBaseUrl()) connect();
    else disconnect();
  });
  return {connect, disconnect};
}
