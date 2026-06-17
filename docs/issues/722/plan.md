# Issue 722: Per-mode theme selection

## Summary

Add separate Appearance theme assignments for the effective light and dark modes. The active Mode control stays as Light / Dark / System, while the Theme section always shows both Light theme and Dark theme pickers.

## Implementation

- Replace the single persisted `appearance.color` with `appearance.lightColor` and `appearance.darkColor`.
- Apply the theme color that matches the resolved mode: Light uses `lightColor`, Dark uses `darkColor`, and System follows the OS preference listener.
- Migrate legacy settings by copying the old single color into both new fields, preserving existing users' visible theme.
- Default fresh installs to Light = Mono, Dark = Prose, Mode = System, Icon = Pilcrow.
- Keep the Appearance pane keyboard radio behavior for both theme groups.

## Verification

- `npm run build`
- Manual QA: choose different Light and Dark themes, switch Mode between Light / Dark / System, and confirm the applied theme follows the effective mode.
- Manual QA: reset Appearance and confirm Light = Mono, Dark = Prose, Mode = System, Icon = Pilcrow.
