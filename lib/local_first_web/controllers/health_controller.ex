defmodule LocalFirstWeb.HealthController do
  use LocalFirstWeb, :controller

  def show(conn, _params) do
    case Ecto.Adapters.SQL.query(LocalFirst.Repo, "SELECT 1", []) do
      {:ok, _} -> json(conn, %{status: "ok"})
      {:error, _} -> conn |> put_status(:service_unavailable) |> json(%{status: "unavailable"})
    end
  end
end
