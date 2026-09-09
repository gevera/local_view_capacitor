defmodule LocalFirstWeb.Layouts do
  use LocalFirstWeb, :html
  embed_templates "layouts/*"

  attr :flash, :map, required: true
  slot :inner_block, required: true

  def app(assigns) do
    ~H"""
    <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header class="mb-8 border-b border-base-300 pb-6">
        <p class="mb-2 text-sm text-base-content/60">Local First</p>
        <h1 class="text-3xl font-bold tracking-tight">Report submissions</h1>
        <p class="mt-3 text-base-content/70">
          Capture reports wherever you are. Keep working, even without a connection.
        </p>
      </header>
      <main>{render_slot(@inner_block)}</main>
      <footer class="mt-10 border-t border-base-300 pt-4 text-sm text-base-content/60">
        Saved reports stay on this device and sync automatically when the server is reachable.
      </footer>
    </div>
    """
  end
end
