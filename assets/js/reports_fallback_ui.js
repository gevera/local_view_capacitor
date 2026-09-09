// Android WebView cannot enable SharedArrayBuffer (no site isolation), so
// LocalLiveView / AtomVM cannot boot inside Capacitor. This HTML UI reuses the
// same IndexedDB report store and mobile sync path.

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function blankForm(now = new Date().toISOString().slice(0, 16)) {
  return {id: "", version: null, title: "", description: "", timestamp: now, status: "draft"};
}

export function mountReportsFallbackUI(store, root = document.querySelector("main")) {
  if (!root || !store) return;

  const host = document.createElement("div");
  host.id = "reports-fallback";
  host.className = "space-y-6";
  // Keep any existing sync-settings panel; only replace the LLV mount stubs.
  const stub = root.querySelector("#reports-local");
  if (stub?.parentElement && stub.parentElement !== root) {
    stub.parentElement.remove();
  } else {
    stub?.remove();
    root.querySelector("#reports-local-llv-event-bus")?.remove();
  }
  root.querySelector("#reports-fallback")?.remove();
  root.append(host);

  let form = blankForm();
  let confirming = "";
  let notice = "";
  let saving = false;
  let latest = {
    reports: [],
    pending: 0,
    conflict: null,
    connection: "Offline",
    syncing: false,
    error: "",
    offline_ready: true,
    now: form.timestamp
  };

  const render = () => {
    const reports = latest.reports || [];
    host.innerHTML = `
      <p class="text-sm text-base-content/60">
        Android WebView cannot run the Elixir WASM runtime. This device UI uses the same offline storage and sync API.
      </p>
      <div class="flex flex-wrap items-center gap-3" aria-live="polite">
        <span class="badge" id="connection-status">${escapeHtml(latest.connection)}</span>
        <span class="badge" id="pending-status">${latest.pending} pending</span>
        <span class="text-sm" id="offline-status">Ready for offline use</span>
        <button type="button" id="sync-now" class="btn"${latest.syncing ? " disabled" : ""}>
          ${latest.syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
      ${latest.error ? `<div class="alert" role="alert" id="report-error">${escapeHtml(latest.error)}</div>` : ""}
      ${notice ? `<p role="status" id="save-notice" class="text-sm">${escapeHtml(notice)}</p>` : ""}
      ${latest.conflict ? `
        <div class="alert" id="sync-conflict" role="alert">
          <div class="space-y-3">
            <p class="font-semibold">This report changed on the server.</p>
            <p>Your local work is safe. Choose which version to keep before syncing continues.</p>
            ${latest.conflict.server ? `<p>Server title: ${escapeHtml(latest.conflict.server.title)}</p>` : ""}
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn" id="keep-local">Keep my version</button>
              <button type="button" class="btn" id="use-server">Use server version</button>
            </div>
          </div>
        </div>` : ""}
      <div class="grid items-start gap-8 lg:grid-cols-5">
        <section class="card bg-base-200 lg:col-span-2" aria-labelledby="form-heading">
          <div class="card-body">
            <h2 class="card-title" id="form-heading">${form.id ? "Edit report" : "New report"}</h2>
            <p class="text-sm text-base-content/70">Save here, sync when connected.</p>
            <form id="report-form" class="space-y-2">
              <fieldset class="fieldset"${saving ? " disabled" : ""}>
                <label class="label" for="report-title">Title</label>
                <input class="input w-full" id="report-title" name="title" required maxlength="200" value="${escapeHtml(form.title)}" />
                <label class="label" for="report-description">Description</label>
                <textarea class="textarea w-full" id="report-description" name="description" rows="5" required maxlength="10000">${escapeHtml(form.description)}</textarea>
                <label class="label" for="report-timestamp">Timestamp (UTC)</label>
                <input class="input w-full" id="report-timestamp" type="datetime-local" name="timestamp" required value="${escapeHtml(form.timestamp)}" />
                <label class="label" for="report-status">Status</label>
                <select class="select w-full" id="report-status" name="status">
                  <option value="draft"${form.status === "draft" ? " selected" : ""}>Draft</option>
                  <option value="submitted"${form.status === "submitted" ? " selected" : ""}>Submitted</option>
                  <option value="resolved"${form.status === "resolved" ? " selected" : ""}>Resolved</option>
                </select>
                <div class="flex flex-wrap gap-2 pt-4">
                  <button class="btn" type="submit" id="save-report">${saving ? "Saving…" : "Save report"}</button>
                  ${form.id ? `<button class="btn" type="button" id="cancel-edit">Cancel edit</button>` : ""}
                </div>
              </fieldset>
            </form>
          </div>
        </section>
        <section class="space-y-4 lg:col-span-3" aria-labelledby="reports-heading">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold" id="reports-heading">Reports</h2>
            <span class="badge">${reports.length}</span>
          </div>
          ${reports.length === 0 ? `
            <div class="card bg-base-200" id="empty-reports">
              <div class="card-body">
                <h3 class="card-title">No reports yet</h3>
                <p>Create your first report using the form. You can keep working offline.</p>
              </div>
            </div>` : `
            <div id="reports-list" class="space-y-4">
              ${reports.map(report => `
                <article id="report-${escapeHtml(report.id)}" class="card bg-base-200">
                  <div class="card-body">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <h3 class="card-title break-words">${escapeHtml(report.title)}</h3>
                      <span class="badge">${escapeHtml(report.status)}</span>
                    </div>
                    <p class="whitespace-pre-wrap break-words">${escapeHtml(report.description)}</p>
                    <time datetime="${escapeHtml(report.timestamp)}" class="text-sm text-base-content/70">${escapeHtml(report.timestamp)} (UTC)</time>
                    ${confirming === report.id ? `
                      <div class="space-y-2 pt-2">
                        <p>Delete this report? This will also delete the synced copy.</p>
                        <div class="card-actions">
                          <button type="button" class="btn" data-confirm-delete="${escapeHtml(report.id)}">Confirm delete</button>
                          <button type="button" class="btn" data-cancel-delete>Keep report</button>
                        </div>
                      </div>` : `
                      <div class="card-actions pt-2">
                        <button type="button" class="btn" data-edit="${escapeHtml(report.id)}"${saving ? " disabled" : ""}>Edit</button>
                        <button type="button" class="btn" data-ask-delete="${escapeHtml(report.id)}"${saving ? " disabled" : ""}>Delete</button>
                      </div>`}
                  </div>
                </article>`).join("")}
            </div>`}
        </section>
      </div>
    `;

    host.querySelector("#sync-now")?.addEventListener("click", () => void store.requestSync?.());
    host.querySelector("#keep-local")?.addEventListener("click", () => window.reportBridge.command("keep_local", {}));
    host.querySelector("#use-server")?.addEventListener("click", () => window.reportBridge.command("use_server", {}));
    host.querySelector("#cancel-edit")?.addEventListener("click", () => {
      form = blankForm(latest.now);
      notice = "";
      render();
    });
    host.querySelector("#report-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const data = new FormData(event.target);
      saving = true;
      notice = "";
      render();
      try {
        await store.save({
          id: form.id || undefined,
          version: form.version,
          title: data.get("title"),
          description: data.get("description"),
          timestamp: data.get("timestamp"),
          status: data.get("status")
        });
        form = blankForm(latest.now);
        notice = "Saved on this device.";
      } catch (error) {
        latest = {...latest, error: error.message};
      } finally {
        saving = false;
        render();
      }
    });
    host.querySelectorAll("[data-edit]").forEach(button => {
      button.addEventListener("click", () => {
        const report = reports.find(item => item.id === button.getAttribute("data-edit"));
        if (!report) return;
        form = {
          id: report.id,
          version: report.version,
          title: report.title,
          description: report.description,
          timestamp: String(report.timestamp).slice(0, 16),
          status: report.status
        };
        notice = "";
        confirming = "";
        render();
      });
    });
    host.querySelectorAll("[data-ask-delete]").forEach(button => {
      button.addEventListener("click", () => {
        confirming = button.getAttribute("data-ask-delete") || "";
        render();
      });
    });
    host.querySelector("[data-cancel-delete]")?.addEventListener("click", () => {
      confirming = "";
      render();
    });
    host.querySelector("[data-confirm-delete]")?.addEventListener("click", async () => {
      const id = host.querySelector("[data-confirm-delete]")?.getAttribute("data-confirm-delete");
      confirming = "";
      if (id) window.reportBridge.command("delete", {id});
      if (form.id === id) form = blankForm(latest.now);
      render();
    });
  };

  const previousNotify = store.notify;
  store.notify = async (event, payload) => {
    latest = {...latest, ...payload};
    if (event === "saved") notice = "Saved on this device.";
    if (!form.timestamp && payload.now) form = blankForm(payload.now);
    render();
    if (previousNotify && previousNotify !== store.notify) await previousNotify(event, payload);
  };

  render();
  void store.snapshot();
}
