defmodule LocalFirst.Reporting.SyncReport do
  @moduledoc "Version-checked, retry-safe synchronization through Ash actions."
  use Ash.Resource.Actions.Implementation
  alias LocalFirst.Reporting

  @impl true
  def run(input, _opts, _context) do
    %{mutation_id: mutation_id, base_version: version, report: params} = input.arguments

    with {:ok, id} <- Ash.Type.cast_input(:uuid, params["id"]),
         true <- is_binary(id),
         {:ok, report} <- Reporting.get_report(id, not_found_error?: false) do
      attrs =
        params
        |> Map.take(["title", "description", "timestamp", "status", "deleted"])
        |> Map.put("last_mutation_id", mutation_id)

      cond do
        report && report.last_mutation_id == mutation_id ->
          success(report)

        is_nil(report) && version == 0 ->
          attrs |> Map.put("id", id) |> Reporting.create_report() |> result(id)

        report && report.version == version ->
          Reporting.update_report(report, attrs) |> result(id)

        true ->
          conflict(report)
      end
    else
      _ -> {:error, "A valid report UUID is required"}
    end
  end

  defp result({:ok, report}, _id), do: success(report)

  defp result({:error, error}, id) do
    # A competing writer can win between the read and the optimistic update.
    # Ash validates and locks the write; return a conflict without discarding work.
    errors = Map.get(error, :errors, [error])

    if Enum.any?(errors, &match?(%Ash.Error.Changes.StaleRecord{}, &1)) ||
         Enum.any?(errors, &match?(%Ash.Error.Changes.InvalidAttribute{field: :id}, &1)) do
      with {:ok, report} <- Reporting.get_report(id, not_found_error?: false),
           do: conflict(report)
    else
      {:error, error}
    end
  end

  defp success(report), do: {:ok, %{result: "ok", report: serialize(report)}}
  defp conflict(report), do: {:ok, %{result: "conflict", report: serialize(report)}}

  def serialize(nil), do: nil

  def serialize(report) do
    %{
      id: report.id,
      title: report.title,
      description: report.description,
      timestamp: DateTime.to_iso8601(report.timestamp),
      status: report.status,
      deleted: report.deleted,
      version: report.version
    }
  end
end
