defmodule LocalFirstWeb.PageController do
  use LocalFirstWeb, :controller

  def offline(conn, _params), do: render(conn, :offline)
end
