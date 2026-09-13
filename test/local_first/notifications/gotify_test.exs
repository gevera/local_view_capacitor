defmodule LocalFirst.Notifications.GotifyTest do
  use ExUnit.Case, async: true

  alias LocalFirst.Notifications.Gotify

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
      assert conn.method == "POST"
      assert conn.request_path == "/message"
      assert conn.query_string =~ "token=test-token"

      {:ok, body, conn} = Plug.Conn.read_body(conn)
      payload = Jason.decode!(body)

      send(self(), {:gotify_payload, payload})
      Req.Test.json(conn, %{"id" => 1})
    end)

    :ok
  end

  test "posts a delete message to Gotify" do
    report = %{id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", title: "Broken gate"}

    assert :ok = Gotify.notify_report_deleted(report)

    assert_received {:gotify_payload,
                     %{
                       "title" => "Report deleted",
                       "message" => "Broken gate (aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)",
                       "priority" => 5
                     }}
  end

  test "is a no-op when url or token is blank" do
    Application.put_env(:local_first, Gotify, url: "", token: "test-token", async: false)

    assert :ok = Gotify.notify_report_deleted(%{id: "x", title: "Nope"})
    refute_received {:gotify_payload, _}
  end

  test "log_boot_status reports enabled when configured" do
    assert :ok = Gotify.log_boot_status()
  end

  test "swallows Gotify HTTP errors" do
    Req.Test.stub(Gotify, fn conn ->
      conn
      |> Plug.Conn.put_resp_content_type("application/json")
      |> Plug.Conn.send_resp(500, ~s({"error":"boom"}))
    end)

    assert :ok = Gotify.notify_report_deleted(%{id: "x", title: "Still ok"})
  end

  defp restore_gotify_env(nil), do: Application.delete_env(:local_first, Gotify)
  defp restore_gotify_env(previous), do: Application.put_env(:local_first, Gotify, previous)
end
