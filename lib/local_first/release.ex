defmodule LocalFirst.Release do
  @moduledoc "Database operations for the production release."

  def migrate do
    Application.load(:local_first)

    for repo <- Application.fetch_env!(:local_first, :ecto_repos) do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end
end
