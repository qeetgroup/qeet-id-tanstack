# Engineering practices

The practices this package follows, and where each comes from. Researched on 5 November 2026 against TanStack Start
1.169, TanStack Router 1.170 and React 19.3. When a practice changes, change it here first and record why.

## The model: a backend for frontend

| Practice | How this package applies it | Source |
| --- | --- | --- |
| The app's server is the OAuth client, and a confidential one | The server holds the client secret and runs the code flow; the browser talks only to `{base}/*` and never holds a token | [RFC 10017 §6.1](https://www.rfc-editor.org/rfc/rfc10017.html) (BCP 212, "The BFF MUST act as a confidential client", §6.1.3.1) |
| Authorization code with PKCE S256, for every client | A fresh 32-byte verifier per sign-in; the challenge is base64url(SHA-256(verifier)) | [RFC 7636 §4](https://www.rfc-editor.org/rfc/rfc7636#section-4); [RFC 9700 §2.1.1](https://www.rfc-editor.org/rfc/rfc9700#section-2.1.1); [OWASP OAuth 2.0 cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html) |
| `state` and `nonce` bound to the browser | Both random, sealed into a sign-in cookie of their own (one per sign-in, so two tabs don't collide), checked in constant time at the callback, the cookie deleted either way | [OpenID Connect Core §3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest), [§15.5.2](https://openid.net/specs/openid-connect-core-1_0.html#NonceNotes); [RFC 9700 §4.7](https://www.rfc-editor.org/rfc/rfc9700#section-4.7) |
| The issuer of the authorization response is checked | `iss` on the callback must equal the discovered issuer (Qeet ID advertises `authorization_response_iss_parameter_supported`) | [RFC 9207 §2.4](https://www.rfc-editor.org/rfc/rfc9207#section-2.4); [RFC 9700 §4.4](https://www.rfc-editor.org/rfc/rfc9700#section-4.4) |
| The ID token is verified before it is trusted | ES256 signature against the JWKS, `iss`, `aud` (and `azp` with several audiences), `exp`, `iat`, then `nonce`; done by `@qeet-id/node`'s `TokenVerifier` | [OpenID Connect Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation); [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725) |
| A renewed ID token names the same person | `sub` must match the session's; otherwise the session ends and the new grant is revoked | [OpenID Connect Core §12.2](https://openid.net/specs/openid-connect-core-1_0.html#RefreshTokenResponse) |
| Refresh tokens rotate, so a spent one is never sent twice | One renewal per refresh token, shared by concurrent requests and reused for a minute (ADR-0003) | [RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700#section-4.14.2); Qeet ID's `RefreshToken` reuse detection |
| The session lasts as long as the refresh token can | Default lifetime 30 days, rolling at each renewal; ended at once when Qeet ID refuses the refresh | [RFC 10017 §6.1.2.2](https://www.rfc-editor.org/rfc/rfc10017.html) ("session lifetime … equal to the maximum lifetime of the refresh token") |
| Signing out ends it at the issuer too | The refresh token is revoked (RFC 7009) and the browser goes to the end-session endpoint with `id_token_hint` | [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009); [OpenID Connect RP-Initiated Logout 1.0 §2](https://openid.net/specs/openid-connect-rpinitiated-1_0.html); [OWASP session management: logout](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) |

## Cookies

| Practice | How | Source |
| --- | --- | --- |
| `Secure`, `HttpOnly`, `Path=/`, no `Domain`, the `__Host-` prefix | On every cookie, over https; on plain-http `localhost` only `Secure` and the prefix are dropped | [RFC 10017 §6.1.3.2](https://www.rfc-editor.org/rfc/rfc10017.html); [OWASP session management: cookies](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#cookies); [RFC 6265bis §4.1.3](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) |
| `SameSite=Lax`, not `Strict` | The callback and the redirect after it are navigations that started on Qeet ID's site, which a `Strict` cookie doesn't follow. CSRF is stopped by the custom header instead | The session contract (`@qeet-id/react`, docs/session-contract.md); RFC 10017 §6.1.3.2 recommends `Strict` (SHOULD), §6.1.3.3.2 the header defence used here |
| Contents encrypted and authenticated | A JWE (`dir`, `A256GCM`) by Web Crypto, one key per secret and purpose by HKDF-SHA-256; expiry inside the sealed value, checked on every read (ADR-0001) | [RFC 10017 §6.1.3.2](https://www.rfc-editor.org/rfc/rfc10017.html) ("SHOULD encrypt its cookie contents"); [RFC 7516](https://www.rfc-editor.org/rfc/rfc7516); [RFC 7518 §5.3](https://www.rfc-editor.org/rfc/rfc7518#section-5.3); [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869) |
| Secrets rotate without signing anyone out | The first secret seals, every listed secret unseals; the key id in the header picks the key | [OWASP cryptographic storage: key rotation](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) |
| Values too long for one cookie are chunked, and only then | 3800 characters a chunk, within the 4096 bytes a browser keeps per cookie; stale chunks deleted | [RFC 6265 §6.1](https://www.rfc-editor.org/rfc/rfc6265#section-6.1) |
| At most 400 days | `QEET_ID_SESSION_MAX_AGE` is capped there | [RFC 6265bis §5.5](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) |

## CSRF, redirects and caching

| Practice | How | Source |
| --- | --- | --- |
| A custom request header on every state-changing request | `POST` routes need `X-Qeet-ID-Request: 1`; a cross-site page can't send it without a CORS preflight, and no route answers one | [RFC 10017 §6.1.3.3.2](https://www.rfc-editor.org/rfc/rfc10017.html); [OWASP CSRF prevention: custom request headers](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) |
| Fetch Metadata and `Origin` as further checks | `Sec-Fetch-Site: cross-site` and an `Origin` other than the app's are refused | [OWASP CSRF prevention: Fetch Metadata, verifying origin](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html); [web.dev: Fetch Metadata](https://web.dev/articles/fetch-metadata) |
| No state change on GET | Sign-out and switching organisation are POST only; GETs only start a sign-in or read | [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) ("Do not use GET requests for state changing operations") |
| CSRF for server functions | Documented: add TanStack Start's `createCsrfMiddleware` in `src/start.ts`, which Start stops adding once the file exists | [TanStack Start: middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware) |
| Same-origin return paths only | Every `returnTo` goes through the contract's `safeReturnTo`; the browser is sent to its result, never the input | [OWASP unvalidated redirects](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html) ("use local-only helpers") |
| A failed sign-in doesn't loop | The guard throws the callback's `authError` instead of sending the browser to sign in again | — |
| Nothing personal in a shared cache | `Cache-Control: no-store` on every session route and on any response that read the session | [OWASP session management: caching](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#web-content-caching); [RFC 9111 §5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.5) |
| The callback leaks no code in `Referer` | `Referrer-Policy: no-referrer` on the redirects | [RFC 9700 §4.2.4](https://www.rfc-editor.org/rfc/rfc9700#section-4.2.4) |

## TanStack Start

| Practice | How | Source |
| --- | --- | --- |
| HTTP endpoints are server routes | One catch-all `src/routes/auth/$.ts` with `authRouteHandlers` (an `ANY` handler) serves the six routes (ADR-0002) | [TanStack Start: server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes) |
| Data the app reads is a server function | `getSession` is a `createServerFn`: direct on the server while rendering, an RPC on navigation | [TanStack Start: server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions) |
| Server functions can ship from a package | Any package with `@tanstack/react-start` in `peerDependencies` is compiled by the Start plugin (it is excluded from dependency pre-bundling and kept in the SSR build), so its server functions and middleware split like the app's. Server-only modules are reached by dynamic imports inside the server bodies | `@tanstack/start-plugin-core` (`crawlFrameworkPkgs` in `vite/plugin.js`); WorkOS's `@workos/authkit-tanstack-react-start` ships `getAuth` the same way |
| Protect the data, not only the page | `requireSession` guards pages; `requireSessionMiddleware` protects server functions and server routes, and the README says to use both | [TanStack Start: authentication](https://tanstack.com/start/latest/docs/framework/react/guide/authentication) ("`beforeLoad` is for route UX, not data security"); [TanStack Start: middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware) |
| Derive the session on the server | Middleware reads the cookie on the server, never anything the client sends in context | [TanStack Start: middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware) ("Derive the session on the server") |
| Pages are reached by full navigation | The guard redirects with `reloadDocument`, since the session routes aren't router pages | [TanStack Router: redirect](https://tanstack.com/router/latest/docs/framework/react/api/router/redirectFunction) |
| No session flash | The root route's `beforeLoad` reads the session; the provider takes it from the router context as `initialSession` | `@qeet-id/react`'s `QeetIDProvider` (`initialSession`); Clerk's TanStack Start guide reads auth in the root `beforeLoad` the same way |
| Not TanStack's own session helpers | Start 1.169 no longer exports `useSession`/`sealSession`; its guide now uses iron-session. This package seals its own JWE (ADR-0001) | `@tanstack/start-server-core` 1.169 exports; [TanStack Start: authentication](https://tanstack.com/start/latest/docs/framework/react/guide/authentication) |

## API shape

| Practice | How | Source |
| --- | --- | --- |
| Configuration from the environment, every problem at once | `QEET_ID_*` variables; `ConfigurationError.problems` names each variable and never a value | [The Twelve-Factor App: config](https://12factor.net/config); the Qeet ID console's `productionConfigProblems` |
| Secrets out of logs | The client secret, cookie secrets and API key are non-enumerable on the config; warnings carry an error's name and code only | [OWASP logging: data to exclude](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude) |
| Errors extend the Node SDK's | `ConfigurationError`, `NotSignedInError`, `SessionUnavailableError` extend `@qeet-id/node`'s `QeetIDError`, each with a stable `code` | `@qeet-id/node` ADR-0003 |
| Named exports only, two entry points | `@qeet-id/tanstack` (browser-safe) and `@qeet-id/tanstack/server` | [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html); the WorkOS and Clerk TanStack packages' client/server split |

## Packaging

| Practice | How | Source |
| --- | --- | --- |
| ES modules only | TanStack Start and `@tanstack/react-start` are ES-module only; `attw --profile esm-only` | [Node.js: packages](https://nodejs.org/api/packages.html); [Are the types wrong?](https://github.com/arethetypeswrong/arethetypeswrong.github.io) |
| Unflattened output, `sideEffects: false` | One file per module, so the Start compiler and bundlers see each module as written | [Azure SDK: implementation](https://azure.github.io/azure-sdk/typescript_implementation.html) |
| Peers for what the app must share | TanStack Start, TanStack Router, React, `@qeet-id/react` (one React context) and `@qeet-id/node` (one error hierarchy) | WorkOS's TanStack package lists `@workos-inc/node` as a peer |
| Runtimes follow the Node.js schedule | `engines.node >=22.12.0`; CI on 22, 24 and 26 | [Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) |
| Package checks before publishing | `publint --strict` and `attw --pack . --profile esm-only` in `bun run verify` | [publint rules](https://publint.dev/rules) |
| Build tool | tsdown, with `isolatedDeclarations` | [tsdown](https://tsdown.dev/guide/) |
| Provenance; versions and history | `publishConfig.provenance`; Semantic Versioning and Keep a Changelog | [npm provenance](https://docs.npmjs.com/generating-provenance-statements); [semver.org](https://semver.org/spec/v2.0.0.html); [keepachangelog.com](https://keepachangelog.com/en/1.1.0/) |

## Compared with other TanStack Start integrations

| | WorkOS AuthKit | Clerk | This package |
| --- | --- | --- | --- |
| Setup | `authkitMiddleware()` in `src/start.ts`, a callback route file, `AuthKitProvider` | `clerkMiddleware()` in `src/start.ts`, `ClerkProvider` | One catch-all route file, `QeetIDProvider`; middleware optional |
| Session in loaders | `getAuth()` server function | `auth()` inside an app-written server function | `getSession()` server function |
| Tokens | Encrypted cookie on the app's server | Clerk's own cookies and frontend API | Encrypted cookie on the app's server |
| Page protection | Loader redirect | `beforeLoad` redirect | `requireSession()` `beforeLoad` |

Sources: [WorkOS AuthKit for TanStack Start](https://workos.com/docs/sdks/authkit-tanstack-start); [Clerk: clerkMiddleware for TanStack React Start](https://clerk.com/docs/reference/tanstack-react-start/clerk-middleware).
