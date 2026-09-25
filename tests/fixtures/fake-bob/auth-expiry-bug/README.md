# Fake Bob scenario: auth-expiry-bug

Pre-authored, deterministic stand-ins for Bob output, used by `FakeBobAdapter`
in tests and local development. Zero Bobcoins.

Kept **outside** `fixtures/auth-expiry-bug/` on purpose: a real Bob run
investigating the fixture must never see these answers.

- `reproduction.json` + `files/reproduction/` — the regression test (fails on baseline: expected 401, received 500).
- `strategies.json` — three strategies `a`, `b`, `c`.
- `files/candidates/<id>/` — full-file replacements per candidate.
  - `a` — maps `TokenExpiredError` in the HTTP error mapper → eligible.
  - `b` — deliberately over-broad catch-all → fixes the bug but breaks the
    `account_disabled` (403) and `service_unavailable` (503) tests → rejected.
  - `c` — explicit handling in the refresh route → eligible.
