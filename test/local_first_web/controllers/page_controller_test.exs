defmodule LocalFirstWeb.PageControllerTest do
  use LocalFirstWeb.ConnCase

  test "GET /", %{conn: conn} do
    conn = get(conn, ~p"/")
    doc = conn |> html_response(200) |> LazyHTML.from_document()

    assert LazyHTML.query(doc, "#reports-local[data-pop-view='ReportsLocal']") |> Enum.count() ==
             1
  end
end
