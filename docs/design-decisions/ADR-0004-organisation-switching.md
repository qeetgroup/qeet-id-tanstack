# ADR-0004: Organisation switching answers 501

**Status:** Accepted

## Context

The contract has `POST {base}/switch-organization`. At Qeet ID, an application's authorization code, and so
its ID token's `tenant_id`, is always the application's own organisation; a person who isn't a member is
refused (`internal/federation/oidc/authorize.go`, `AuthorizeInLoginSession`). The authorize endpoint takes
no organisation parameter. `POST /v1/auth/switch-tenant` exists, but only for a person's own session: an
application's access token is refused everywhere except `/v1/oauth/userinfo`
(`internal/bootstrap/router.go`, `RefuseApplicationTokens(ApplicationTokenRoutes())`).

## Decision

`POST {base}/switch-organization` checks the CSRF header, the body and the session like any POST, answers
`200 { session }` when the organisation asked for is the one the session is in, and
`501 organization_switch_unavailable` for any other, as the contract says. `organization` on sign-in is
accepted and ignored.

## Why

The route can't do what Qeet ID doesn't. Answering for the current organisation keeps an organisation
switcher that lists one organisation working; `501` tells the browser SDK the feature isn't there rather
than that the request was wrong. When Qeet ID lets an application choose the organisation (an `organization`
parameter on authorize, or a switch an application may call), the route can do it without the browser SDK
changing.
