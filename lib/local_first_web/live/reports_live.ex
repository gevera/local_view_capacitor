defmodule LocalFirstWeb.ReportsLive do
  use LocalFirstWeb, :live_view

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash}>
      <.local_live_view view="ReportsLocal" id="reports-local" />
    </Layouts.app>
    """
  end
end
