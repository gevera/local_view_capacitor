// IndexedDB is the durable source for this browser. Elixir owns the form and UI;
// this adapter supplies browser storage, UUIDs, and HTTP synchronization.
import {isNativePlatform, mobileReportsUrl, getSyncBaseUrl} from "./native_platform.js";

const DB_NAME = "local-first-reports";
const emptyState = () => ({reports: {}, outbox: [], conflict: null});

function mergeReports(state, reports) {
  const pending = new Set(state.outbox.map(op => op.report.id));
  for (const report of reports) {
    if (!pending.has(report.id) && (!state.reports[report.id] || report.version > state.reports[report.id].version)) {
      state.reports[report.id] = report;
    }
  }
  return state;
}

export function openDatabase(indexedDB = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transaction(db, change) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    const store = tx.objectStore("state");
    const request = store.get("reports");
    let result;
    request.onsuccess = () => {
      try {
        result = change(request.result || emptyState());
        store.put(result, "reports");
      } catch (error) {
        reject(error);
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Local save was cancelled."));
  });
}

export class ReportStore {
  constructor(db, {
    fetcher = globalThis.fetch.bind(globalThis),
    notify = () => {},
    uuid = () => crypto.randomUUID(),
    native = isNativePlatform,
    syncBaseUrl = getSyncBaseUrl
  } = {}) {
    this.db = db;
    this.fetcher = fetcher;
    this.notify = notify;
    this.uuid = uuid;
    this.native = native;
    this.syncBaseUrl = syncBaseUrl;
    this.syncing = false;
    this.reachable = false;
    this.error = "";
    this.offlineReady = false;
  }

  async snapshot(event = "state") {
    const state = await transaction(this.db, state => state);
    await this.notify(event, {
      reports: Object.values(state.reports).filter(r => !r.deleted).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id)),
      pending: state.outbox.length,
      conflict: state.conflict,
      connection: this.reachable ? "Online" : "Offline",
      syncing: this.syncing,
      error: this.error,
      offline_ready: this.offlineReady,
      now: new Date().toISOString().slice(0, 16)
    });
    return state;
  }

  async save(fields, deleted = false) {
    const timestamp = new Date(fields.timestamp.endsWith("Z") ? fields.timestamp : `${fields.timestamp}:00Z`);
    if (!fields.title?.trim() || fields.title.trim().length > 200 || !fields.description?.trim() || fields.description.trim().length > 10000 || !["draft", "submitted", "resolved"].includes(fields.status) || Number.isNaN(timestamp.getTime())) {
      throw new Error("Enter a title, description, valid UTC timestamp, and status.");
    }
    await transaction(this.db, state => {
      const id = fields.id || this.uuid();
      const previous = state.reports[id];
      // Preserve the version the user began editing, even if a background pull
      // received a newer copy while the form was open.
      const baseVersion = Number.isInteger(fields.version) ? fields.version : (previous?.version || 0);
      const report = {id, title: fields.title.trim(), description: fields.description.trim(), timestamp: timestamp.toISOString(), status: fields.status, deleted, version: baseVersion + 1};
      state.outbox.push({mutation_id: this.uuid(), base_version: baseVersion, report});
      state.reports[id] = report;
      return state;
    });
    this.error = "";
    await this.snapshot("saved");
    this.onChange?.();
  }

  async remove(id) {
    const state = await transaction(this.db, state => state);
    if (state.reports[id]) await this.save(state.reports[id], true);
  }

  async receiveReports(reports) {
    await transaction(this.db, state => mergeReports(state, reports));
    await this.snapshot();
    this.onChange?.(false);
  }

  async resolveConflict(choice) {
    await transaction(this.db, state => {
      if (!state.conflict) return state;
      const {id, server} = state.conflict;
      const local = state.reports[id];
      state.outbox = state.outbox.filter(op => op.report.id !== id);
      if (choice === "keep_local") {
        const report = {...local, version: (server?.version || 0) + 1};
        state.outbox.push({mutation_id: this.uuid(), base_version: server?.version || 0, report});
        state.reports[id] = report;
      } else if (server) {
        state.reports[id] = server;
      } else {
        delete state.reports[id];
      }
      state.conflict = null;
      return state;
    });
    this.error = "";
    await this.snapshot();
    this.onChange?.();
  }

  async request(path, options = {}) {
    const {credentials: optionCredentials, ...rest} = options;
    const credentials = optionCredentials ?? (this.native() ? "omit" : "same-origin");
    return this.fetcher(path, {cache: "no-store", signal: AbortSignal.timeout(10000), ...rest, credentials});
  }

  syncEndpoints() {
    if (this.native()) {
      const reports = mobileReportsUrl(this.syncBaseUrl());
      if (!reports) return null;
      return {session: null, reports, headers: {"content-type": "application/json"}};
    }
    return {
      session: "/sync/session",
      reports: "/sync/reports",
      headers: {"content-type": "application/json"}
    };
  }

  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const endpoints = this.syncEndpoints();
      if (!endpoints) {
        this.reachable = false;
        this.error = "Set a sync server URL to sync. Changes are saved on this device.";
        return;
      }

      let headers = {...endpoints.headers};
      if (endpoints.session) {
        // Fetch a fresh CSRF token; the offline shell may have an old session token.
        const session = await this.request(endpoints.session);
        if (!session.ok) throw new Error("Server unavailable. Changes are saved on this device.");
        const {csrf_token: token} = await session.json();
        headers = {...headers, "x-csrf-token": token};
      }

      this.reachable = true;
      this.error = "";
      await this.snapshot();
      while (true) {
        const state = await transaction(this.db, state => state);
        if (state.conflict || state.outbox.length === 0) break;
        const operation = state.outbox[0];
        const response = await this.request(endpoints.reports, {
          method: "POST",
          headers,
          body: JSON.stringify(operation)
        });
        const body = await response.json();
        if (response.status === 409) {
          await transaction(this.db, current => ({...current, conflict: {id: operation.report.id, server: body.report || null}}));
          break;
        }
        if (!response.ok) throw new Error(body.error || "Sync failed. Your changes remain on this device.");
        await transaction(this.db, current => {
          current.outbox = current.outbox.filter(op => op.mutation_id !== operation.mutation_id);
          // Replace our optimistic copy on acknowledgment, but never roll back
          // a newer version already delivered by PubSub.
          if (!current.outbox.some(op => op.report.id === operation.report.id) &&
              (current.reports[body.report.id]?.version || 0) <= body.report.version) {
            current.reports[body.report.id] = body.report;
          }
          return current;
        });
      }
      const response = await this.request(endpoints.reports);
      if (!response.ok) throw new Error("Unable to refresh reports. Local changes are safe.");
      const {reports} = await response.json();
      await transaction(this.db, state => mergeReports(state, reports));
    } catch (error) {
      this.reachable = false;
      this.error = error instanceof TypeError || error.name === "TimeoutError" || error.name === "AbortError"
        ? "Server unreachable. Changes are saved on this device and will retry automatically."
        : error.message;
    } finally {
      this.syncing = false;
      await this.snapshot();
      this.onChange?.(false);
    }
  }
}

export async function startReportStore(engine) {
  const notify = (event, payload) => engine.pushEvent("reports-local", event, payload);
  let store;
  try {
    store = new ReportStore(await openDatabase(), {notify});
  } catch (_) {
    await notify("storage_error", {error: "Browser storage is unavailable. Enable site storage before saving reports."});
    return;
  }
  const channel = new BroadcastChannel("local-first-reports");
  // One outbox sender across tabs. Coalesce requests without losing a channel
  // rejoin/catch-up request that arrives during an existing HTTP sync.
  let requested = false;
  let running = null;
  const sync = () => {
    requested = true;
    if (running) return running;
    running = navigator.locks.request("reports-sync", async () => {
      do {
        requested = false;
        await store.sync();
      } while (requested);
    }).finally(() => {
      running = null;
      if (requested) void sync();
    });
    return running;
  };
  store.requestSync = sync;
  store.onChange = (send = true) => {
    channel.postMessage("changed");
    if (send) void sync();
  };
  channel.onmessage = () => void store.snapshot();
  window.reportBridge = {
    command(action, payload) {
      const commands = {
        save: () => store.save(payload),
        delete: () => store.remove(payload.id),
        retry: sync,
        keep_local: () => store.resolveConflict("keep_local"),
        use_server: () => store.resolveConflict("use_server")
      };
      Promise.resolve().then(commands[action]).catch(async error => {
        store.error = `Could not save: ${error.message}. Keep the form open and try again.`;
        await store.snapshot("save_error");
      });
    }
  };
  await store.snapshot();
  window.addEventListener("online", sync);
  window.addEventListener("offline", () => { store.reachable = false; void store.snapshot(); });
  window.addEventListener("reports-offline-ready", () => { store.offlineReady = true; void store.snapshot(); });
  setInterval(sync, 15000);
  void sync();
  return store;
}
