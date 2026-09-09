defmodule LocalFirstWeb.SyncController do
  use LocalFirstWeb, :controller
  alias LocalFirst.Reporting
  alias LocalFirst.Reporting.SyncReport

  plug :no_cache

  def session(conn, _params), do: json(conn, %{csrf_token: get_csrf_token()})

  def index(conn, _params) do
    case Reporting.list_reports() do
      {:ok, reports} ->
        json(conn, %{reports: Enum.map(reports, &SyncReport.serialize/1)})

      {:error, _} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{error: "Reports are temporarily unavailable."})
    end
  end

  def sync(conn, params) do
    case Reporting.sync_report(Map.take(params, ["mutation_id", "base_version", "report"])) do
      {:ok, %{result: "ok"} = result} ->
        json(conn, result)

      {:ok, %{result: "conflict"} = result} ->
        conn |> put_status(:conflict) |> json(result)

      {:error, _} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error:
            "Invalid report. Check title (1–200 characters), description (1–10,000), timestamp, and status."
        })
    end
  end

  defp no_cache(conn, _opts), do: put_resp_header(conn, "cache-control", "no-store")
end
