# syntax=docker/dockerfile:1

# LocalLiveView / Popcorn requires Elixir 1.17.3 and OTP 26.0.2.
ARG ELIXIR_VERSION=1.17.3
ARG OTP_VERSION=26.0.2
ARG DEBIAN_VERSION=bookworm-20260824-slim

ARG BUILDER_IMAGE="hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION}"
ARG RUNNER_IMAGE="debian:${DEBIAN_VERSION}"

FROM ${BUILDER_IMAGE} AS builder

# No Node.js: Phoenix assets use Mix-managed esbuild + tailwind, and
# Capacitor is only for the Android app (built outside this image).
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends build-essential git curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

ENV MIX_ENV=prod

COPY mix.exs mix.lock ./
COPY config config
COPY local local
RUN mix deps.get --only prod \
  && mix deps.compile

# Install asset tooling in its own layer so rebuilds reuse the ~100MB+ binaries.
RUN mix assets.setup

COPY assets assets
COPY priv priv
COPY lib lib

RUN mix compile \
  && mix assets.deploy \
  && mix release

FROM ${RUNNER_IMAGE}

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen \
  && locale-gen

ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8
ENV MIX_ENV=prod
ENV PHX_SERVER=true
ENV DATABASE_PATH=/data/local_first.db

WORKDIR /app

RUN mkdir -p /data \
  && chown nobody /data

COPY --from=builder --chown=nobody:root /app/_build/prod/rel/local_first ./
COPY --chmod=755 scripts/docker-entrypoint.sh /app/bin/docker-entrypoint.sh

USER nobody

EXPOSE 4000

ENTRYPOINT ["/app/bin/docker-entrypoint.sh"]
CMD ["start"]
