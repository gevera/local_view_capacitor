defmodule LocalFirstWeb.ReportsChannelTest do
  use LocalFirst.DataCase, async: false
  import Phoenix.ChannelTest

  @endpoint LocalFirstWeb.Endpoint

  test "a joined browser receives PubSub changes from Ash writes" do
    assert {:ok, _, _socket} =
             LocalFirstWeb.ReportsSocket
             |> socket("reports-test", %{})
             |> subscribe_and_join(LocalFirstWeb.ReportsChannel, "reports:all")

    report = LocalFirst.Reporting.create_report!(%{title: "Live report", description: "Details"})
    id = report.id
    assert_push "report_changed", %{report: %{id: ^id, title: "Live report", version: 1}}

    report = LocalFirst.Reporting.update_report!(report, %{description: "Updated live"})
    assert_push "report_changed", %{report: %{id: ^id, description: "Updated live", version: 2}}

    LocalFirst.Reporting.delete_report!(report)
    assert_push "report_changed", %{report: %{id: ^id, deleted: true, version: 3}}
  end
end
