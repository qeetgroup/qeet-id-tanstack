<div align="center">

# 🔐 Qeet ID for TanStack Start

**Sign-in, sessions and route protection for TanStack Start apps: people sign in on Qeet ID's hosted pages, and tokens stay on your server.**

[![TanStack Start](https://img.shields.io/badge/TanStack-Start-FF4154?logo=reactquery&logoColor=white)](#-how-it-fits)
[![TanStack Router](https://img.shields.io/badge/TanStack-Router-FF4154?logo=reactrouter&logoColor=white)](#-how-it-fits)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](#-how-it-fits)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](#-how-it-fits)
[![OpenID Connect](https://img.shields.io/badge/OpenID%20Connect-code%20%2B%20PKCE-F78C40?logo=openid&logoColor=white)](#-how-sign-in-works)

[🌐 Qeet ID](https://id.qeet.in) · [📖 Docs](https://docs.qeet.in) · [⚛️ React SDK](https://github.com/qeetgroup/qeet-id-react) · [🟢 Node SDK](https://github.com/qeetgroup/qeet-id-node)

</div>

## 🧭 What it's for

`@qeet-id/tanstack` adds **Sign in with Qeet ID** to a TanStack Start app. Visitors sign in on Qeet ID's hosted pages with a passkey, a password or a magic link, and come back signed in. Your server functions, loaders and route guards know who they are, and so do your components. The access and refresh tokens live in an encrypted, http-only cookie session on your server; the browser never holds them.

## 📦 What's inside

| | |
|:--|:--|
| 🚪 **Server routes** | Sign-in, callback and sign-out, with state, nonce and PKCE checked on the way back |
| 🍪 **Sessions** | An encrypted, http-only, `SameSite` cookie session, renewed before the access token expires |
| 🛡️ **Protection** | Request middleware and a `beforeLoad` guard that send signed-out visitors to sign in, and back where they were |
| 👤 **Server helpers** | The signed-in person and their organisation in server functions and loaders |
| 🏢 **Organisations** | Switching organisation re-issues the session for the one chosen |
| ⚛️ **Client side** | `@qeet-id/react`'s hooks and buttons, wired to these routes |

## 🔗 How it fits

| Package | Runs in | Role |
|:--|:--|:--|
| [`@qeet-id/react`](https://github.com/qeetgroup/qeet-id-react) | Browser | `useUser`, `useSession`, sign-in and sign-out buttons, `SignedIn` / `SignedOut` |
| **`@qeet-id/tanstack`** | TanStack Start server and browser | This package: server routes, session, protection |
| [`@qeet-id/node`](https://github.com/qeetgroup/qeet-id-node) | Server | Code exchange, token verification, the management API |

## 🔑 How sign-in works

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as Your TanStack Start app
    participant Q as Qeet ID
    B->>A: Sign in
    A->>B: Redirect to the hosted page (state, nonce, PKCE)
    B->>Q: Sign in with a passkey, password or magic link
    Q->>B: Redirect to /callback with a code
    B->>A: /callback?code=…
    A->>Q: Exchange the code (client secret + PKCE verifier)
    Q->>A: Tokens
    A->>B: Encrypted session cookie, then the page
```

## 🧱 You need

| | |
|:--|:--|
| ⚙️ **TanStack Start** | With TanStack Router and React 19 |
| 🟢 **Node.js** | 22.12 or later, as `@qeet-id/node` needs |
| 🔐 **A Qeet ID application** | A confidential web application in your organisation, with your callback URL as a redirect URI |

## 🛠️ Working on it

| | |
|:--|:--|
| 🌿 **Branches** | Work lands on `develop`; `main` changes only by a pull request from `develop` |
| 🏷️ **Versions** | `vX.Y.Z` tags, made when the release workflow is run on `main` |
| 📦 **Package manager** | bun |

<div align="center">

Made with 🧡 by Qeet Group · [⬆️ Back to top](#-qeet-id-for-tanstack-start)

</div>
