defmodule LocalFirst.ReportingTest do
  use LocalFirst.DataCase, async: false
  alias LocalFirst.Reporting

  defp operation(attrs \\ %{}) do
    %{
      mutation_id: Ash.UUID.generate(),
      base_version: 0,
      report:
        Map.merge(
          %{
            "id" => Ash.UUID.generate(),
            "title" => "Inspection",
            "description" => "North entrance needs repair.",
            "timestamp" => "2026-09-09T09:00:00.000Z",
            "status" => "draft",
            "deleted" => false
          },
          attrs
        )
    }
  end

  test "creates, edits, and deletes reports through Ash backed by SQLite" do
    {:ok, report} = Reporting.create_report(%{title: "Report", description: "Details"})
    assert report.status == "draft"
    assert %DateTime{} = report.timestamp
    {:ok, edited} = Reporting.update_report(report, %{status: "submitted", title: "Updated"})
    assert edited.version == 2
    {:ok, deleted} = Reporting.delete_report(edited)
    assert deleted.deleted
    assert Reporting.get_report!(report.id).version == 3
  end

  test "sync retries do not duplicate a report or increment its version" do
    op = operation()
    assert {:ok, %{result: "ok", report: first}} = Reporting.sync_report(op)
    assert {:ok, %{result: "ok", report: ^first}} = Reporting.sync_report(op)
    assert length(Reporting.list_reports!()) == 1

    edit = %{
      op
      | mutation_id: Ash.UUID.generate(),
        base_version: 1,
        report: Map.put(op.report, "title", "Edited")
    }

    assert {:ok, %{report: %{version: 2} = second}} = Reporting.sync_report(edit)
    assert {:ok, %{report: ^second}} = Reporting.sync_report(edit)
  end

  test "stale offline writes conflict and cannot silently resurrect a deletion" do
    op = operation()
    assert {:ok, %{report: %{version: 1}}} = Reporting.sync_report(op)

    delete = %{
      op
      | mutation_id: Ash.UUID.generate(),
        base_version: 1,
        report: Map.put(op.report, "deleted", true)
    }

    assert {:ok, %{report: %{deleted: true, version: 2}}} = Reporting.sync_report(delete)
    stale = %{op | mutation_id: Ash.UUID.generate(), base_version: 1}

    assert {:ok, %{result: "conflict", report: %{deleted: true, version: 2}}} =
             Reporting.sync_report(stale)

    assert Reporting.get_report!(op.report["id"]).deleted
  end

  test "optimistic locking rejects updating an old Ash record" do
    {:ok, report} = Reporting.create_report(%{title: "Report", description: "Details"})
    assert {:ok, _} = Reporting.update_report(report, %{title: "First writer"})
    assert {:error, _} = Reporting.update_report(report, %{title: "Stale writer"})
    assert Reporting.get_report!(report.id).title == "First writer"
  end

  test "invalid attributes never enter the database" do
    for attrs <- [
          %{"title" => "  "},
          %{"description" => ""},
          %{"status" => "unknown"},
          %{"timestamp" => "bad"},
          %{"id" => "bad"},
          %{"title" => String.duplicate("x", 201)}
        ] do
      assert {:error, _} = Reporting.sync_report(operation(attrs))
    end

    assert Reporting.list_reports!() == []
  end

  test "successful CRUD broadcasts committed report versions, but retries and failures do not" do
    :ok = LocalFirst.Reporting.ReportNotifier.subscribe()
    op = operation()
    assert {:ok, %{report: %{id: id}}} = Reporting.sync_report(op)
    assert_receive {:report_changed, %{id: ^id, version: 1, deleted: false}}
    assert Reporting.get_report!(id).version == 1

    assert {:ok, _} = Reporting.sync_report(op)
    refute_receive {:report_changed, _}
    assert {:error, _} = Reporting.sync_report(operation(%{"title" => ""}))
    refute_receive {:report_changed, _}

    report = Reporting.get_report!(id)
    assert {:ok, edited} = Reporting.update_report(report, %{title: "Changed"})
    assert_receive {:report_changed, %{id: ^id, version: 2, title: "Changed"}}
    assert {:error, _} = Reporting.update_report(report, %{title: "Stale"})
    refute_receive {:report_changed, _}
    assert {:ok, _} = Reporting.delete_report(edited)
    assert_receive {:report_changed, %{id: ^id, version: 3, deleted: true}}
  end
end
