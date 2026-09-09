import {test} from "node:test";
import assert from "node:assert/strict";
import {IDBFactory} from "fake-indexeddb";
import {openDatabase, transaction, ReportStore} from "../../assets/js/report_store.js";

const fields = {title: "Site inspection", description: "Check the north entrance.", timestamp: "2026-09-09T10:00", status: "draft"};
const response = (body, status = 200) => new Response(JSON.stringify(body), {status});
const setup = async fetcher => new ReportStore(await openDatabase(new IDBFactory()), {fetcher});

test("offline create, edit, delete and outbox survive a new store instance", async () => {
  const store = await setup(async () => { throw new TypeError("offline"); });
  await store.save(fields);
  let state = await store.snapshot();
  const report = Object.values(state.reports)[0];
  await store.save({...report, title: "Updated inspection"});
  await store.remove(report.id);
  await store.sync();
  state = await new ReportStore(store.db).snapshot();
  assert.equal(state.reports[report.id].title, "Updated inspection");
  assert.equal(state.reports[report.id].deleted, true);
  assert.deepEqual(state.outbox.map(op => op.base_version), [0, 1, 2]);
  assert.equal(state.outbox.length, 3);
});

test("reconnect drains operations in order and reconciles a tombstone", async () => {
  let server = null;
  const versions = [];
  const store = await setup(async (path, options) => {
    if (path === "/sync/session") return response({csrf_token: "token"});
    if (options.method === "POST") {
      const op = JSON.parse(options.body);
      versions.push(op.base_version);
      server = op.report;
      return response({report: server});
    }
    return response({reports: server ? [server] : []});
  });
  await store.save(fields);
  const report = Object.values((await store.snapshot()).reports)[0];
  await store.save({...report, status: "submitted"});
  await store.remove(report.id);
  await store.sync();
  assert.deepEqual(versions, [0, 1, 2]);
  assert.equal((await store.snapshot()).outbox.length, 0);
  assert.equal(server.deleted, true);
});

test("an edit made during a request is retained after its predecessor is acknowledged", async () => {
  let store;
  let posts = 0;
  store = await setup(async (path, options) => {
    if (path === "/sync/session") return response({csrf_token: "token"});
    if (options.method === "POST") {
      const op = JSON.parse(options.body);
      if (++posts === 1) await store.save({...op.report, title: "Edited during sync"});
      return response({report: op.report});
    }
    return response({reports: []});
  });
  await store.save(fields);
  await store.sync();
  const state = await store.snapshot();
  assert.equal(posts, 2);
  assert.equal(Object.values(state.reports)[0].title, "Edited during sync");
  assert.equal(state.outbox.length, 0);
});

test("conflicts preserve local edits until explicitly resolved", async () => {
  let remote;
  const store = await setup(async (path, options) => {
    if (path === "/sync/session") return response({csrf_token: "token"});
    if (options.method === "POST") return response({report: remote}, 409);
    return response({reports: [remote]});
  });
  await store.save(fields);
  const local = Object.values((await store.snapshot()).reports)[0];
  remote = {...local, title: "Remote edit", version: 5};
  await store.sync();
  let state = await store.snapshot();
  assert.equal(state.reports[local.id].title, fields.title);
  assert.equal(state.outbox.length, 1);
  assert.equal(state.conflict.server.version, 5);
  await store.resolveConflict("keep_local");
  state = await store.snapshot();
  assert.equal(state.outbox[0].base_version, 5);
  assert.equal(state.reports[local.id].version, 6);
  await transaction(store.db, state => ({...state, conflict: {id: local.id, server: remote}}));
  await store.resolveConflict("use_server");
  state = await store.snapshot();
  assert.equal(state.reports[local.id].title, "Remote edit");
  assert.equal(state.outbox.length, 0);
});

test("invalid submissions and failed local writes never announce a saved report", async () => {
  const store = await setup(async () => response({}));
  await assert.rejects(store.save({...fields, title: "  "}));
  assert.equal((await store.snapshot()).outbox.length, 0);
  store.db.close();
  await assert.rejects(store.save(fields));
});

test("server validation failures retain queued work", async () => {
  const store = await setup(async path => path === "/sync/session"
    ? response({csrf_token: "token"})
    : response({error: "Invalid report"}, 422));
  await store.save(fields);
  await store.sync();
  assert.equal((await store.snapshot()).outbox.length, 1);
  assert.equal(store.error, "Invalid report");
});

test("saving an open form retains its original version after a background refresh", async () => {
  const store = await setup(async () => response({}));
  await store.save(fields);
  const original = Object.values((await store.snapshot()).reports)[0];
  await transaction(store.db, state => {
    state.outbox = [];
    state.reports[original.id] = {...original, title: "Someone else edited", version: 4};
    return state;
  });
  await store.save({...original, description: "My unsaved changes"});
  assert.equal((await store.snapshot()).outbox[0].base_version, 1);
});

test("realtime updates persist, ignore duplicate/older versions, and apply tombstones", async () => {
  const store = await setup(async () => response({}));
  const report = {...fields, id: "remote", timestamp: "2026-09-09T10:00:00Z", deleted: false, version: 1};
  await store.receiveReports([report]);
  await store.receiveReports([{...report, title: "New title", version: 2}]);
  await store.receiveReports([report]);
  assert.equal((await store.snapshot()).reports.remote.title, "New title");
  await store.receiveReports([{...report, deleted: true, version: 3}]);
  await store.receiveReports([{...report, version: 2}]);
  const state = await new ReportStore(store.db).snapshot();
  assert.equal(state.reports.remote.deleted, true);
  assert.equal(state.outbox.length, 0);
});

test("realtime changes cannot overwrite pending local work or clear its outbox", async () => {
  const store = await setup(async () => response({}));
  await store.save(fields);
  const original = Object.values((await store.snapshot()).reports)[0];
  await store.receiveReports([{...original, title: "Someone else's report", deleted: true, version: 9}]);
  const state = await store.snapshot();
  assert.equal(state.reports[original.id].title, fields.title);
  assert.equal(state.reports[original.id].deleted, false);
  assert.equal(state.outbox.length, 1);
});

test("an older HTTP snapshot cannot roll back a realtime update", async () => {
  let store;
  const report = {...fields, id: "remote", timestamp: "2026-09-09T10:00:00Z", deleted: false, version: 1};
  store = await setup(async path => {
    if (path === "/sync/session") return response({csrf_token: "token"});
    await store.receiveReports([{...report, title: "Latest via PubSub", version: 2}]);
    return response({reports: [report]});
  });
  await store.sync();
  assert.equal((await store.snapshot()).reports.remote.title, "Latest via PubSub");
});

test("native sync uses the mobile API without CSRF when a base URL is set", async () => {
  const calls = [];
  const store = new ReportStore(await openDatabase(new IDBFactory()), {
    native: () => true,
    syncBaseUrl: () => "https://reports.example.com",
    fetcher: async (path, options = {}) => {
      calls.push({path, method: options.method || "GET", headers: options.headers || {}, credentials: options.credentials});
      if (options.method === "POST") {
        const op = JSON.parse(options.body);
        return response({report: op.report});
      }
      return response({reports: []});
    }
  });
  await store.save(fields);
  await store.sync();
  assert.equal(store.error, "");
  assert.equal((await store.snapshot()).outbox.length, 0);
  assert.deepEqual(calls.map(c => c.path), [
    "https://reports.example.com/api/mobile/v1/reports",
    "https://reports.example.com/api/mobile/v1/reports"
  ]);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].credentials, "omit");
  assert.equal(calls[0].headers["x-csrf-token"], undefined);
});

test("native sync without a base URL keeps local changes and explains the gap", async () => {
  const store = new ReportStore(await openDatabase(new IDBFactory()), {
    native: () => true,
    syncBaseUrl: () => "",
    fetcher: async () => {
      throw new Error("network should not be called");
    }
  });
  await store.save(fields);
  await store.sync();
  assert.equal((await store.snapshot()).outbox.length, 1);
  assert.match(store.error, /Set a sync server URL/);
});
