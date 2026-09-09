defmodule LocalFirstWeb.ReportsChannel do
  use Phoenix.Channel

  @impl true
  def join("reports:all", _params, socket) do
    :ok = LocalFirst.Reporting.ReportNotifier.subscribe()
    {:ok, socket}
  end

  @impl true
  def handle_info({:report_changed, report}, socket) do
    push(socket, "report_changed", %{report: report})
    {:noreply, socket}
  end
end
