defmodule LocalFirst.Notifications.Gotify do
  @moduledoc """
  Sends Gotify push messages when configured.

  When `GOTIFY_URL` / `GOTIFY_APP_TOKEN` (or the matching config keys) are unset,
  calls are no-ops so local and test environments stay quiet.
  """

  require Logger

  @doc """
  Notifies subscribed Gotify clients that a report was deleted.
  Returns `:ok` even when disabled or when Gotify returns an error (logged).
  """
  def notify_report_deleted(report) when is_map(report) do
    case config() do
      %{url: url, token: token}
      when is_binary(url) and url != "" and is_binary(token) and token != "" ->
        send_message(url, token, %{
          title: "Report deleted",
          message: message_body(report),
          priority: Keyword.get(Application.get_env(:local_first, __MODULE__, []), :priority, 5)
        })

      _ ->
        :ok
    end
  end

  defp message_body(%{title: title, id: id}) when is_binary(title) do
    "#{title} (#{id})"
  end

  defp message_body(%{id: id}), do: "Report #{id} was deleted"
  defp message_body(_), do: "A report was deleted"

  defp send_message(url, token, payload) do
    base = String.trim_trailing(url, "/")
    opts = [url: "#{base}/message", params: [token: token], json: payload] ++ req_options()

    case Req.post(opts) do
      {:ok, %{status: status}} when status in 200..299 ->
        :ok

      {:ok, %{status: status, body: body}} ->
        Logger.warning("Gotify notify failed with status #{status}: #{inspect(body)}")
        :ok

      {:error, reason} ->
        Logger.warning("Gotify notify request error: #{inspect(reason)}")
        :ok
    end
  end

  defp config do
    conf = Application.get_env(:local_first, __MODULE__, [])

    %{
      url: Keyword.get(conf, :url),
      token: Keyword.get(conf, :token)
    }
  end

  defp req_options do
    Application.get_env(:local_first, __MODULE__, [])
    |> Keyword.get(:req_options, [])
  end
end
