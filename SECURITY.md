# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately — do not open a public GitHub issue. Email
**security@qeet.in** with:

- A description of the vulnerability and its impact.
- Steps to reproduce, against this package rather than the Qeet ID service.
- The package version (`import { VERSION } from "@qeet-id/tanstack"`), and the TanStack Start and Node.js
  versions.

We aim to acknowledge reports within 2 business days.

## Scope

This policy covers `@qeet-id/tanstack` itself. The most sensitive parts:

- `src/core/crypto.ts` — sealing the cookies (JWE `dir`/`A256GCM`, HKDF keys, rotation).
- `src/core/auth.ts` — state, nonce, PKCE, the issuer check, ID token checks, renewal and sign-out.
- `src/core/routes.ts` — the CSRF defence, return paths, caching headers.
- `src/tanstack/` — what reaches the browser bundle.

Vulnerabilities in the Qeet ID service itself should be reported through Qeet ID's own security channel.

## Supported versions

The latest minor version receives security fixes.

## Disclosure

We'll credit reporters (unless anonymity is requested) in the release notes once a fix ships.
