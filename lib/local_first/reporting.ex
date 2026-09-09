defmodule LocalFirst.Reporting do
  use Ash.Domain,
    otp_app: :local_first

  resources do
    resource LocalFirst.Reporting.Report do
      define :list_reports, action: :read
      define :get_report, action: :read, get_by: [:id]
      define :create_report, action: :create
      define :update_report, action: :update
      define :delete_report, action: :delete
      define :sync_report, action: :sync
    end
  end
end
