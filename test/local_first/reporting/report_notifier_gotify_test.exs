defmodule LocalFirst.Reporting.ReportNotifierGotifyTest do
  use LocalFirst.DataCase, async: false

  alias LocalFirst.Notifications.Gotify
  alias LocalFirst.Reporting

  @gotify_config [
    url: "http://gotify.test",
    token: "test-token",
    async: false,
    priority: 5,
    req_options: [plug: {Req.Test, Gotify}]
  ]

  setup do
    previous = Application.get_env(:local_first, Gotify)
    Application.put_env(:local_first, Gotify, @gotify_config)

    on_exit(fn ->
      restore_gotify_env(previous)
    end)

    Req.Test.stub(Gotify, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      send(self(), {:gotify_payload, Jason.decode!(body)})
      Req.Test.json(conn, %{"id" => 1})
    end)

    :ok
  end

  test "delete_report notifies Gotify once" do
    {:ok, report} = Reporting.create_report(%{title: "Report", description: "Details"})
    refute_received {:gotify_payload, _}

    {:ok, deleted} = Reporting.delete_report(report)
    assert deleted.deleted

    assert_received {:gotify_payload,
                     %{
                       "title" => "Report deleted",
                       "message" => "Report (" <> _
                     }}
  end

  test "updating an already-deleted report does not notify again" do
    {:ok, report} = Reporting.create_report(%{title: "Report", description: "Details"})
    {:ok, deleted} = Reporting.delete_report(report)
    assert_received {:gotify_payload, _}

    {:ok, _} = Reporting.update_report(deleted, %{title: "Still deleted"})
    refute_received {:gotify_payload, _}
  end

  test "sync soft-delete notifies Gotify" do
    id = Ash.UUID.generate()

    op = %{
      mutation_id: Ash.UUID.generate(),
      base_version: 0,
      report: %{
        "id" => id,
        "title" => "Inspection",
        "description" => "North entrance needs repair.",
        "timestamp" => "2026-09-09T09:00:00.000Z",
        "status" => "draft",
        "deleted" => false
      }
    }

    assert {:ok, %{report: %{version: 1}}} = Reporting.sync_report(op)
    refute_received {:gotify_payload, _}

    delete = %{
      op
      | mutation_id: Ash.UUID.generate(),
        base_version: 1,
        report: Map.put(op.report, "deleted", true)
    }

    assert {:ok, %{report: %{deleted: true}}} = Reporting.sync_report(delete)

    assert_received {:gotify_payload,
                     %{
                       "title" => "Report deleted",
                       "message" => "Inspection (" <> _
                     }}
  end

  defp restore_gotify_env(nil), do: Application.delete_env(:local_first, Gotify)
  defp restore_gotify_env(previous), do: Application.put_env(:local_first, Gotify, previous)
end
