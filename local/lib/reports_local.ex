defmodule ReportsLocal do
  @moduledoc "Report form and interactions executed in the browser by LocalLiveView."
  use LocalLiveView

  @impl true
  def mount(_params, _session, socket) do
    {:ok,
     assign(socket,
       reports: [],
       form: to_form(blank(""), as: :report),
       editing: "",
       editing_version: nil,
       confirming: "",
       now: "",
       ready: false,
       saving: false,
       pending: 0,
       connection: "Starting",
       syncing: false,
       offline_ready: false,
       conflict: nil,
       error: "",
       notice: ""
     )}
  end

  @impl true
  def update(_assigns, socket), do: {:ok, socket}

  @impl true
  def handle_info({:js_push, event, payload}, socket)
      when event in ["state", "saved", "save_error"] do
    reset? = !socket.assigns.ready || (event == "saved" && socket.assigns.saving)

    socket =
      assign(socket,
        reports: payload["reports"],
        pending: payload["pending"],
        connection: payload["connection"],
        syncing: payload["syncing"],
        offline_ready: payload["offline_ready"],
        conflict: payload["conflict"],
        error: payload["error"],
        now: payload["now"],
        ready: true
      )

    socket = if reset?, do: reset_form(socket), else: socket
    socket = if event in ["saved", "save_error"], do: assign(socket, saving: false), else: socket

    socket =
      if event == "saved", do: assign(socket, notice: "Saved on this device."), else: socket

    {:noreply, socket}
  end

  def handle_info({:js_push, "storage_error", %{"error" => error}}, socket) do
    {:noreply, assign(socket, error: error, ready: false)}
  end

  @impl true
  def handle_event("validate", %{"report" => params}, socket) do
    {:noreply, assign(socket, form: to_form(params, as: :report), notice: "")}
  end

  def handle_event("save", %{"report" => params}, socket) do
    params =
      params
      |> Map.put("id", socket.assigns.editing)
      |> Map.put("version", socket.assigns.editing_version)

    if String.trim(params["title"] || "") == "" || String.trim(params["description"] || "") == "" do
      {:noreply,
       assign(socket,
         error: "Title and description are required.",
         form: to_form(params, as: :report)
       )}
    else
      command("save", params)
      {:noreply, assign(socket, saving: true, form: to_form(params, as: :report), error: "")}
    end
  end

  def handle_event("edit", %{"id" => id}, socket) do
    case Enum.find(socket.assigns.reports, &(&1["id"] == id)) do
      nil ->
        {:noreply, socket}

      report ->
        params = Map.put(report, "timestamp", String.slice(report["timestamp"], 0, 16))

        {:noreply,
         assign(socket,
           editing: id,
           editing_version: report["version"],
           form: to_form(params, as: :report),
           notice: "",
           error: ""
         )}
    end
  end

  def handle_event("cancel", _params, socket), do: {:noreply, reset_form(socket)}

  def handle_event("ask_delete", %{"id" => id}, socket),
    do: {:noreply, assign(socket, confirming: id)}

  def handle_event("cancel_delete", _params, socket),
    do: {:noreply, assign(socket, confirming: "")}

  def handle_event("delete", %{"id" => id}, socket) do
    command("delete", %{"id" => id})
    socket = if socket.assigns.editing == id, do: reset_form(socket), else: socket
    {:noreply, assign(socket, confirming: "")}
  end

  def handle_event(event, _params, socket) when event in ["retry", "keep_local", "use_server"] do
    command(event, %{})
    {:noreply, socket}
  end

  defp command(action, payload) do
    Popcorn.Wasm.run_js(
      "({args}) => { window.reportBridge.command(args.action, args.payload); return []; }",
      %{action: action, payload: payload}
    )
  end

  defp blank(now),
    do: %{"title" => "", "description" => "", "timestamp" => now, "status" => "draft"}

  defp reset_form(socket) do
    assign(socket,
      form: to_form(blank(socket.assigns.now), as: :report),
      editing: "",
      editing_version: nil,
      error: ""
    )
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="space-y-6" id="reports-app">
      <div class="flex flex-wrap items-center gap-3" aria-live="polite">
        <span class="badge" id="connection-status">{@connection}</span>
        <span class="badge" id="pending-status">{@pending} pending</span>
        <span class="text-sm" id="offline-status">
          {if @offline_ready, do: "Ready for offline use", else: "Preparing offline access…"}
        </span>
        <button id="sync-now" class="btn" phx-click="retry" disabled={!@ready || @syncing}>
          {if @syncing, do: "Syncing…", else: "Sync now"}
        </button>
      </div>

      <div :if={@error != ""} class="alert" role="alert" id="report-error">{@error}</div>
      <p :if={@notice != ""} role="status" id="save-notice" class="text-sm">{@notice}</p>

      <div :if={@conflict} class="alert" id="sync-conflict" role="alert">
        <div class="space-y-3">
          <p class="font-semibold">This report changed in another browser.</p>
          <p>Your local work is safe. Choose which version to keep before syncing continues.</p>
          <p :if={@conflict["server"]}>Server title: {@conflict["server"]["title"]}</p>
          <div class="flex flex-wrap gap-2">
            <button class="btn" phx-click="keep_local">Keep my version</button>
            <button class="btn" phx-click="use_server">Use server version</button>
          </div>
        </div>
      </div>

      <div class="grid items-start gap-8 lg:grid-cols-5">
        <section class="card bg-base-200 lg:col-span-2" aria-labelledby="form-heading">
          <div class="card-body">
            <h2 class="card-title" id="form-heading">
              {if @editing == "", do: "New report", else: "Edit report"}
            </h2>
            <p class="text-sm text-base-content/70">Save here, sync when connected.</p>
            <.form for={@form} id="report-form" phx-change="validate" phx-submit="save">
              <fieldset class="fieldset" disabled={!@ready || @saving}>
                <label class="label" for="report-title">Title</label>
                <input
                  class="input w-full"
                  id="report-title"
                  name="report[title]"
                  value={@form[:title].value}
                  required
                  maxlength="200"
                />
                <label class="label" for="report-description">Description</label>
                <textarea
                  class="textarea w-full"
                  id="report-description"
                  name="report[description]"
                  rows="5"
                  required
                  maxlength="10000"
                >{@form[:description].value}</textarea>
                <label class="label" for="report-timestamp">Timestamp (UTC)</label>
                <input
                  class="input w-full"
                  id="report-timestamp"
                  type="datetime-local"
                  name="report[timestamp]"
                  value={@form[:timestamp].value}
                  required
                />
                <label class="label" for="report-status">Status</label>
                <select class="select w-full" id="report-status" name="report[status]">
                  <option value="draft" selected={@form[:status].value == "draft"}>Draft</option>
                  <option value="submitted" selected={@form[:status].value == "submitted"}>
                    Submitted
                  </option>
                  <option value="resolved" selected={@form[:status].value == "resolved"}>
                    Resolved
                  </option>
                </select>
                <div class="flex flex-wrap gap-2 pt-4">
                  <button class="btn" type="submit" id="save-report">{if @saving,
                    do: "Saving…",
                    else: "Save report"}</button>
                  <button :if={@editing != ""} class="btn" type="button" phx-click="cancel">Cancel edit</button>
                </div>
              </fieldset>
            </.form>
          </div>
        </section>

        <section class="space-y-4 lg:col-span-3" aria-labelledby="reports-heading">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold" id="reports-heading">Reports</h2>
            <span class="badge">{length(@reports)}</span>
          </div>
          <div :if={@reports == []} class="card bg-base-200" id="empty-reports">
            <div class="card-body">
              <h3 class="card-title">
                {if @ready, do: "No reports yet", else: "Opening your reports…"}
              </h3>
              <p>Create your first report using the form. You can keep working offline.</p>
            </div>
          </div>
          <div id="reports-list" class="space-y-4">
            <article :for={report <- @reports} id={"report-" <> report["id"]} class="card bg-base-200">
              <div class="card-body">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <h3 class="card-title break-words">{report["title"]}</h3>
                  <span class="badge">{report["status"]}</span>
                </div>
                <p class="whitespace-pre-wrap break-words">{report["description"]}</p>
                <time datetime={report["timestamp"]} class="text-sm text-base-content/70">{report[
                  "timestamp"
                ]} (UTC)</time>
                <div :if={@confirming != report["id"]} class="card-actions pt-2">
                  <button class="btn" phx-click="edit" phx-value-id={report["id"]} disabled={@saving}>Edit</button>
                  <button
                    class="btn"
                    phx-click="ask_delete"
                    phx-value-id={report["id"]}
                    disabled={@saving}
                  >Delete</button>
                </div>
                <div :if={@confirming == report["id"]} class="space-y-2 pt-2">
                  <p>Delete this report? This will also delete the synced copy.</p>
                  <div class="card-actions">
                    <button class="btn" phx-click="delete" phx-value-id={report["id"]}>Confirm delete</button>
                    <button class="btn" phx-click="cancel_delete">Keep report</button>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
    """
  end
end
