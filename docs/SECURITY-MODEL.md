# Security model

## Trust boundaries

- The official ChatGPT app is trusted build input and remains unchanged.
- The patcher has local filesystem and code-signing access by design.
- Each real Codex child is trusted with only its assigned account home.
- The injected renderer in the independent desktop copy is trusted with the
  loopback control token.
- Other local users and remote origins are outside the control API boundary.
- Processes running as the same OS user are not considered isolated from one
  another; they can already read that user's app data subject to OS permissions.

## Credentials

OAuth material stays in `auth.json` under each account's Codex home. The
multiplexer reads an account token only to call the same authenticated ChatGPT
profile and rate-limit-reset endpoints used by the desktop experience. It does
not log or return tokens. State persisted by the mux contains account paths,
labels, enabled state, and thread ownership only.

On macOS, the state root is mode `0700`; state, config, and control-token files
are mode `0600`. On Windows, the installer removes inherited NTFS access and
grants the current user and SYSTEM full control. Existing control tokens are
validated as 256-bit hexadecimal values.

Plugin and MCP configuration is deliberately synchronized from the Primary
account so installed definitions remain consistent. Inline environment values
inside those definitions are therefore copied into every isolated account home
with mode `0600`; account isolation is not a separate secret boundary for
shared plugin configuration.

## Network

The control server binds to `127.0.0.1`. Private endpoints require the token
embedded into the independently built desktop renderer. The token is generated
in the owner-only state directory and is never printed by the installer.
Profile images must use HTTPS. Response sizes and JSON request bodies are
bounded.

The project itself does not provide a telemetry or update endpoint. Network
traffic beyond loopback is performed by the official Codex children or by the
documented ChatGPT profile and rate-limit APIs.

## Signing and native access

The source app is copied into a temporary staging directory. Native modules,
the Computer Use helper, Node runtime, mux, and final app are signed under one
selected Apple team and verified before replacement. Official OpenAI
application-group and keychain entitlements are removed from modified callers.

The native helper's caller allowlist is patched to the selected team and the
independent desktop bundle ID. This is required for the helper's peer checks;
it does not bypass macOS Accessibility or Screen Recording consent.

On Windows, the Microsoft Store package remains immutable. The installer
verifies OpenAI Authenticode signatures before copying, patches only the copied
ASAR for account UI, and keeps the locally compiled mux beside the copied app.
Launch-only environment overrides provide core routing; no persistent
environment variable is created.

## Diagnostics

`CODEX_MUX_UI_TESTS=1` enables deterministic preview and screenshot endpoints.
They are unavailable during a normal launch, bind only to loopback, and require
the same control token. Release workflows never set this variable.

## Distribution

Releases contain source only. Publishing the patched `.app`, copied Windows
application, official ASAR, or any extracted OpenAI binary is outside this
project's release process.
