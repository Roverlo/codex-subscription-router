# Windows account-menu design QA

- Source visual: user-provided Codex profile-menu reference in this task.
- Implementation visual: `.tmp/windows-account-menu-candidate.png`.
- Test state: Windows Codex desktop at 1925 x 1024 with the bottom-left profile
  menu open. The implementation has one real connected subscription; the source
  visual has four, so the data-dependent height and row count intentionally
  differ.
- Visual comparison: the implementation uses the native profile popover, width,
  corner radius, dividers, typography, icon sizing, usage summary, subscription
  row, visible identifier, percentage alignment, and **Add another subscription**
  placement from the source structure. Existing Codex menu items stay below it.
- Interaction check: the profile trigger opens the integrated menu; pooled usage,
  connected subscriptions, and the add-subscription action are visible. Adding
  opens the trusted verification page directly without an intermediate menu row.
  The detached browser manager is absent.
- Runtime check: the automated desktop check reports zero renderer console errors.
- Fixes applied during QA: mapped the reviewed Windows renderer symbols, extended
  only the copied renderer CSP for the loopback API, preserved native unpacked
  modules, and used Windows-compatible avatar/color classes.

final result: passed
