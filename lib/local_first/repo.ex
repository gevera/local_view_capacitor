defmodule LocalFirst.Repo do
  use AshSqlite.Repo, otp_app: :local_first
end
