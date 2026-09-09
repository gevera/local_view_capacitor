defmodule Mix.Tasks.Offline.Build do
  use Mix.Task
  @shortdoc "Builds a versioned offline app cache from the compiled assets"

  @impl true
  def run(_) do
    paths =
      Path.wildcard("priv/static/assets/**/*")
      |> Enum.filter(&File.regular?/1)
      |> Enum.reject(&String.ends_with?(&1, [".gz", ".map"]))

    if paths == [], do: Mix.raise("Build the assets and LocalLiveView bundle first")

    version =
      (paths ++
         Path.wildcard("lib/local_first_web/**/*.{ex,heex}") ++ ["assets/js/service_worker.js"])
      |> Enum.map(&[&1, File.read!(&1)])
      |> then(&:crypto.hash(:sha256, &1))
      |> Base.encode16(case: :lower)

    urls = ["/offline" | Enum.map(paths, &String.replace_prefix(&1, "priv/static", ""))]
    source = File.read!("assets/js/service_worker.js")

    File.write!(
      "priv/static/sw.js",
      "const CACHE = 'reports-#{version}';\nconst ASSETS = #{Jason.encode!(urls)};\n" <> source
    )

    Mix.shell().info("Offline shell: #{length(urls)} cached files")
  end
end
