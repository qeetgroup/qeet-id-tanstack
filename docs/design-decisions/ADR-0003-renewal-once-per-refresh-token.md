# ADR-0003: Renew once per refresh token

**Status:** Accepted

## Context

Qeet ID rotates refresh tokens. When a refresh token that was already used comes back, it assumes theft and
revokes every token of the grant (`handleRefreshReuse` in `internal/federation/oidc/token.go`). A browser
sends requests in parallel (a page and its server functions, several tabs), all with the same cookie; and a
request that left before the renewed cookie arrived still carries the old refresh token. Renewing for each
of them would end the session.

## Decision

The access token is renewed when it has less than a minute left. `OidcClient.renew` keeps one promise per
refresh token: concurrent requests share the call, and its answer is reused for a minute
(`REFRESH_REUSE_MS`) for requests that still carry the spent token. A failed renewal isn't kept, so the next
request may try again.

- Qeet ID refusing the renewal (`invalid_grant`, `unauthorized_client`) ends the session and clears the cookie.
- Qeet ID unreachable keeps the session while its access token still works, and throws
  `SessionUnavailableError` once it doesn't (`503 session_unavailable` from `{base}/session`).
- A renewed ID token must name the same person, or the session ends and the new grant is revoked.

## Why

It is the only way to use rotating refresh tokens from a cookie session without signing people out under
ordinary load. The reuse window answers a request with tokens it would have had a moment later anyway.

**Limit:** the sharing is per process. Across instances, a burst of parallel requests at the moment of
renewal can still race; the README says to route a person's requests to one instance where that matters.
A shared store (Redis, say) would close it, at the cost of a stateful dependency every app would need.
