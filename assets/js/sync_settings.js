import {getSyncBaseUrl, isNativePlatform, setSyncBaseUrl} from "./native_platform.js";

export function mountSyncSettings(store) {
  if (!isNativePlatform()) return;

  const panel = document.createElement("section");
  panel.id = "sync-settings";
  panel.className = "mb-6 rounded-lg border border-base-300 bg-base-200/40 p-4";
  panel.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Sync server</h2>
      <p class="text-sm text-base-content/60">Not baked into the APK — set your Coolify URL here.</p>
    </div>
    <form id="sync-settings-form" class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label class="form-control w-full flex-1">
        <span class="label-text mb-1">Base URL</span>
        <input
          id="sync-base-url"
          name="sync_base_url"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="https://your-app.example.com"
          class="input input-bordered w-full"
        />
      </label>
      <div class="flex gap-2">
        <button id="sync-settings-save" type="submit" class="btn btn-primary">Save</button>
        <button id="sync-settings-now" type="button" class="btn btn-outline">Sync now</button>
      </div>
    </form>
    <p id="sync-settings-status" class="mt-2 text-sm text-base-content/70" role="status"></p>
  `;

  const main = document.querySelector("main");
  if (main) main.prepend(panel);
  else document.body.prepend(panel);

  const input = panel.querySelector("#sync-base-url");
  const status = panel.querySelector("#sync-settings-status");
  input.value = getSyncBaseUrl();
  status.textContent = getSyncBaseUrl()
    ? "Sync server configured."
    : "Set a server URL to sync. Local reports still work offline.";

  panel.querySelector("#sync-settings-form").addEventListener("submit", event => {
    event.preventDefault();
    const saved = setSyncBaseUrl(input.value);
    input.value = saved;
    if (!saved && input.value.trim()) {
      status.textContent = "Enter a valid http(s) URL, for example https://your-app.example.com";
      return;
    }
    status.textContent = saved
      ? `Saved ${saved}. Syncing…`
      : "Cleared sync server. Local reports still work offline.";
    window.dispatchEvent(new CustomEvent("sync-base-url-changed", {detail: {baseUrl: saved}}));
    void store?.requestSync?.();
  });

  panel.querySelector("#sync-settings-now").addEventListener("click", () => {
    if (!getSyncBaseUrl()) {
      status.textContent = "Set a server URL before syncing.";
      return;
    }
    status.textContent = "Syncing…";
    void store?.requestSync?.();
  });
}
