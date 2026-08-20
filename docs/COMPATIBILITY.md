# Compatibility

The installers are intentionally tied to known Codex desktop bundle structures.
They stop instead of patching or copying an unreviewed official build.

## Release 0.1.0

| Component | Tested value |
| --- | --- |
| Official ChatGPT version | `26.803.61601` |
| Official bundle build | `6396` |
| `app.asar` SHA-256 | `d5a44ed9e2f1db5f81dbbe85408aed256f3203c5b16f00817bb9d7cd941343cf` |
| Architecture | Apple silicon (`arm64`) |

A different official version may work when all anchors remain identical, but
it is unverified. The patcher rejects a version, build, or ASAR hash mismatch by
default; `--allow-untested-source` is an explicit diagnostic override. Never
weaken an anchor-count or binary-constant check merely to make a new build
complete. Review the upstream change and update the patch deliberately.

## Windows x64

| Component | Tested value |
| --- | --- |
| Microsoft Store package | `OpenAI.Codex_26.814.5517.0_x64__2p2nqsd0c76g0` |
| Desktop version | `26.814.41957` |
| Desktop build | `6744` |
| `app.asar` SHA-256 | `a872ead5cf8f651185fcbc972247ce0d7884fddedd1f0118a044f0801e33a82d` |
| `codex.exe` SHA-256 | `539d351a0f87d4186673a3bd65a480b2e87ebeb7324045019a2d23729770c092` |
| Codex CLI | `0.148.0-alpha.15` |
| Architecture | Windows x64 |

`install.ps1` also requires valid OpenAI Authenticode signatures on the desktop
and Codex executables. It copies the reviewed Store app without changing its
ASAR or signed binaries and uses the official `CODEX_CLI_PATH` and
`CODEX_ELECTRON_USER_DATA_PATH` overrides at launch. There is no diagnostic
override for an unknown Windows build; review and record it first.
