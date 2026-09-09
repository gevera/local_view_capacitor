defmodule LocalFirstWeb.MobileCors do
  @moduledoc "CORS for the bundled Android client. The report API is a public demo API."
  import Plug.Conn

  def init(opts), do: opts

  def call(%{request_path: "/api/mobile/v1/" <> _} = conn, _opts) do
    case get_req_header(conn, "origin") do
      ["https://localhost"] ->
        conn =
          conn
          |> put_resp_header("access-control-allow-origin", "https://localhost")
          |> put_resp_header("vary", "origin")
          |> put_resp_header("access-control-allow-methods", "GET, POST, OPTIONS")
          |> put_resp_header("access-control-allow-headers", "content-type")

        if conn.method == "OPTIONS", do: conn |> send_resp(204, "") |> halt(), else: conn

      [] ->
        conn

      _ ->
        conn |> send_resp(403, "Origin not allowed") |> halt()
    end
  end

  def call(conn, _opts), do: conn
end
