# Project notes

## Windows support

- Keep the Microsoft Store installation immutable. The Windows build copies the
  reviewed app and uses `CODEX_CLI_PATH` plus
  `CODEX_ELECTRON_USER_DATA_PATH`; its copied ASAR may be patched only for the
  integrated account UI, never for core routing.
- Fail closed when the Store package version, ASAR hash, Codex hash, or OpenAI
  Authenticode signatures differ from `docs/COMPATIBILITY.md`.
- Stop only processes whose executable is below the independent installation
  root. Never stop the official WindowsApps installation during an update.
- Protect `~/.codex-mux` with explicit FullControl for the current user and
  SYSTEM on the root, then reset children to inherit. Do not recursively apply
  directory-only `(OI)(CI)` rules directly to files.
- Keep the control service on `127.0.0.1`, require its 256-bit token for private
  routes, and never print or commit the token, device codes, or account data.

## Verification

Run `npm run check`, `npm run release:check`, and `./install.ps1 -CheckOnly`.
For a Windows desktop smoke test, confirm the copied desktop launches
`codex-mux.exe`, the mux launches the copied signed `codex.exe`, port 48123 is
loopback-only, `/v1/health` succeeds, unauthenticated private requests return
401, the profile menu can add an account, and the desktop console has no errors.
