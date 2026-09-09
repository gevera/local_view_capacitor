defmodule LocalFirst.Reporting.ReportNotifier do
  @moduledoc "Publishes committed report writes, including deletion tombstones."
  use Ash.Notifier

  @topic "reports:changes"

  def subscribe, do: Phoenix.PubSub.subscribe(LocalFirst.PubSub, @topic)

  @impl true
  def notify(%{action: %{type: type}, data: report}) when type in [:create, :update] do
    Phoenix.PubSub.broadcast(
      LocalFirst.PubSub,
      @topic,
      {:report_changed, LocalFirst.Reporting.SyncReport.serialize(report)}
    )
  end

  def notify(_notification), do: :ok
end
