defmodule LocalFirst.Reporting.ReportNotifier do
  @moduledoc "Publishes committed report writes, including deletion tombstones."
  use Ash.Notifier

  alias LocalFirst.Notifications.Gotify

  @topic "reports:changes"

  def subscribe, do: Phoenix.PubSub.subscribe(LocalFirst.PubSub, @topic)

  @impl true
  def notify(%{action: %{type: type}, data: report} = notification)
      when type in [:create, :update] do
    Phoenix.PubSub.broadcast(
      LocalFirst.PubSub,
      @topic,
      {:report_changed, LocalFirst.Reporting.SyncReport.serialize(report)}
    )

    if delete_transition?(notification) do
      schedule_gotify_notify(report)
    end

    :ok
  end

  def notify(_notification), do: :ok

  defp delete_transition?(%{changeset: nil}), do: false

  defp delete_transition?(%{changeset: changeset, data: report}) do
    report.deleted == true and Ash.Changeset.get_data(changeset, :deleted) != true
  end

  defp schedule_gotify_notify(report) do
    conf = Application.get_env(:local_first, Gotify, [])

    if Keyword.get(conf, :async, true) do
      _ = Task.start(fn -> Gotify.notify_report_deleted(report) end)
      :ok
    else
      Gotify.notify_report_deleted(report)
    end
  end
end
