defmodule LocalFirst.Reporting.Report do
  use Ash.Resource,
    otp_app: :local_first,
    domain: LocalFirst.Reporting,
    data_layer: AshSqlite.DataLayer,
    notifiers: [LocalFirst.Reporting.ReportNotifier]

  sqlite do
    table "reports"
    repo LocalFirst.Repo
  end

  attributes do
    uuid_primary_key :id, writable?: true

    attribute :title, :string do
      allow_nil?(false)
      public?(true)
      constraints min_length: 1, max_length: 200, trim?: true
    end

    attribute :description, :string do
      allow_nil?(false)
      public?(true)
      constraints min_length: 1, max_length: 10_000, trim?: true
    end

    attribute :timestamp, :utc_datetime_usec do
      allow_nil?(false)
      public?(true)
      default &DateTime.utc_now/0
    end

    attribute :status, :string do
      allow_nil?(false)
      public?(true)
      default "draft"
    end

    attribute :deleted, :boolean, allow_nil?: false, default: false
    attribute :version, :integer, allow_nil?: false, default: 1
    attribute :last_mutation_id, :uuid

    timestamps()
  end

  actions do
    defaults [:read]

    create :create do
      primary? true
      accept [:id, :title, :description, :timestamp, :status, :deleted, :last_mutation_id]
    end

    update :update do
      primary? true
      require_atomic? false
      accept [:title, :description, :timestamp, :status, :deleted, :last_mutation_id]
      change optimistic_lock(:version)
    end

    update :delete do
      require_atomic? false
      accept [:last_mutation_id]
      change set_attribute(:deleted, true)
      change optimistic_lock(:version)
    end

    action :sync, :map do
      argument :mutation_id, :uuid, allow_nil?: false
      argument :base_version, :integer, allow_nil?: false, constraints: [min: 0]
      argument :report, :map, allow_nil?: false
      run LocalFirst.Reporting.SyncReport
    end
  end

  validations do
    validate one_of(:status, ["draft", "submitted", "resolved"])
  end
end
