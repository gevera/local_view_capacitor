defmodule LocalFirstWeb.ReportsSocket do
  use Phoenix.Socket

  channel "reports:all", LocalFirstWeb.ReportsChannel

  # The application is a shared demo without accounts, like its report API.
  @impl true
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl true
  def id(_socket), do: nil
end
