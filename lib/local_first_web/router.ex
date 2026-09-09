defmodule LocalFirstWeb.Router do
  use LocalFirstWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {LocalFirstWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
    plug :fetch_session
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :mobile_api do
    plug :accepts, ["json"]
  end

  scope "/api/mobile/v1", LocalFirstWeb do
    pipe_through :mobile_api
    get "/reports", SyncController, :index
    post "/reports", SyncController, :sync
  end

  scope "/", LocalFirstWeb do
    get "/healthz", HealthController, :show
  end

  scope "/", LocalFirstWeb do
    pipe_through :browser

    live "/", ReportsLive
    get "/offline", PageController, :offline
  end

  scope "/sync", LocalFirstWeb do
    pipe_through :api
    get "/session", SyncController, :session
    get "/reports", SyncController, :index
    post "/reports", SyncController, :sync
  end
end
