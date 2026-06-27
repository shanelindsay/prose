# Issue 727: Stale File Path Recovery

## Summary

Treat missing read/save targets as recoverable stale-path states rather than raw IPC failures. Missing files and missing parent folders should notify the user, prune dead Recents entries, keep unsaved edits dirty, and route manual saves through Save As.

## Implementation Notes

- `file:save` and `file:read` return structured success/failure results from the main process.
- The preload layer unwraps those results so existing renderer calls can keep using `saveFile()` and `readFile()` with their current signatures.
- Renderer handling detects `ENOENT`/`ENOTDIR`, shows a toast, removes stale Recents entries, and prevents unhandled promise rejections.
- Autosave blocks repeated retries for the failed path until the document path changes.
- Session recovery converts missing saved paths into dirty unsaved tabs using the cached session content.

## Verification

- Build: `npm run build`
- E2E typecheck: `npm run typecheck:e2e`
- Targeted E2E: `npm run test:e2e:dev -- e2e/electron.stale-paths.spec.ts --workers=1 --retries=0`
- Manual QA: open a document, remove its parent folder externally, edit, save, and confirm Save As is offered while edits remain dirty.
