# Plebeian Market Relay

This directory contains the declarative relay deployment assets for both
`staging` and `production`.

## Layout

- `cmd/market-relay/main.go` - Repo-owned `khatru` relay application
- `config/*.env` - Committed stage configuration
- `systemd/market-relay.service` - Systemd unit template used on every host
- `install-relay.sh` - Idempotent remote installer used by GitHub Actions

## Deployment Model

The relay is built from this repository and deployed by
`.github/workflows/deploy-relay.yml`.

Each deploy uploads:

- `market-relay` binary
- systemd unit
- committed stage config
- install script

Then the install script converges the VPS to the desired state:

1. install binary
2. install config
3. install systemd unit
4. create data directories
5. restart `market-relay`
6. verify local NIP-11

## Staging Readiness Gate

`install-staging-relay.sh` gates the staging activation with a bounded local
NIP-11 readiness poll instead of a fixed sleep. The deadline is configurable
via `RELAY_READINESS_SECONDS` (default `60`, sanity-capped at `600`). After
readiness it runs a 60-second steady-state observation window that re-checks
process identity, storage growth, and journal evidence for restarts or OOM.

The installer distinguishes two failure classes by exit code:

- `75` (`EX_TEMPFAIL`) — the process is up and identity/storage are valid, but
  local NIP-11 readiness was not confirmed before the deadline. Operator review
  is required.
- `70` (`EX_SOFTWARE`) — a structural failure where the service may be down.
  Manual intervention is required.

On any failure after files are changed, the script performs a guarded rollback
to the previous binary and unit, then re-verifies the restored process. The
`deploy-relay.yml` workflow surfaces the 75-vs-70 distinction in the
"Classify staging install result" step; the exact exit code is always in the
"Install relay on staging" step logs.

## Stage Config

The stage env files are committed because relay config is operational state that
should live in git:

- `config/staging.env`
- `config/production.env`

Secrets are intentionally not required for the relay service itself.
