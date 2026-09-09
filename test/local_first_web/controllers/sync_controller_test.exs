defmodule LocalFirstWeb.SyncControllerTest do
  use LocalFirstWeb.ConnCase, async: false

  test "report API emits no-store and round-trips a mutation", %{conn: conn} do
    session = get(conn, "/sync/session")
    assert %{"csrf_token" => token} = json_response(session, 200)
    assert get_resp_header(session, "cache-control") == ["no-store"]

    op = %{
      mutation_id: Ash.UUID.generate(),
      base_version: 0,
      report: %{
        id: Ash.UUID.generate(),
        title: "API report",
        description: "Details",
        timestamp: "2026-09-09T09:00:00Z",
        status: "draft"
      }
    }

    synced =
      session |> recycle() |> put_req_header("x-csrf-token", token) |> post("/sync/reports", op)

    assert %{"report" => %{"title" => "API report"}} = json_response(synced, 200)
    assert %{"reports" => [_]} = conn |> get("/sync/reports") |> json_response(200)
  end

  test "invalid sync requests return 422", %{conn: conn} do
    assert %{"error" => _} = conn |> post("/sync/reports", %{}) |> json_response(422)
  end

  test "the offline shell is hostless and carries the WASM isolation headers", %{conn: conn} do
    conn = get(conn, "/offline")
    doc = conn |> html_response(200) |> LazyHTML.from_document()

    assert LazyHTML.query(doc, "#reports-local[data-pop-view='ReportsLocal']") |> Enum.count() ==
             1

    assert LazyHTML.query(doc, "[data-phx-session]") |> Enum.count() == 0
    assert get_resp_header(conn, "cross-origin-opener-policy") == ["same-origin"]
    assert get_resp_header(conn, "cross-origin-embedder-policy") == ["require-corp"]
  end
end
