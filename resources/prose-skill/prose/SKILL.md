---
name: prose
description: Drives Prose for markdown work. For ANY markdown content the user wants to draft, write, create, or edit in the conversation (a README, draft, essay, blog post, article, note, file, or any longform writing), render the inlined prose-editor widget via visualize:show_widget — NOT as a Document · MD / "Presented file" artifact. The widget replaces the built-in markdown artifact for this skill — Document · MD is read-only, the prose-editor widget is editable AND has an Open-in-Prose button that hands the draft off to the Prose desktop app via sendPrompt → create_and_open_file MCP. For documents the user has open in Prose, use Prose's MCP tools (get_outline, read_document, suggest_edit, open_file, create_and_open_file) instead. Activates whenever the user asks to draft, write, create, edit, restructure, summarize, outline, read, tighten, or polish markdown — or when Prose MCP tools are available in the session.
---

# Prose

Markdown editor for macOS with Claude integration. This skill handles two paths: rendering an inline editor widget for new markdown drafts, and using MCP tools to read or edit documents the user already has open in Prose.

## Quick reference

| Situation | Path |
|---|---|
| User asks to draft / write / create new markdown content | **Render the editor widget below** via `visualize:show_widget`. Substitute `__INITIAL_MARKDOWN__` with the draft (HTML-escape `& < > "`), call `show_widget`. Do NOT create a `Document · MD` artifact — this skill exists to override that. Do NOT read `prose-editor.html`, list bundle files, or shell-substitute. The block below is the source of truth. |
| User asks to work on a document already open in Prose | Use MCP tools (`get_outline`, `read_document`, `suggest_edit`). Render outline + diff widgets per the *Outline + diff widgets* section. |
| Both true (user has a doc open AND wants new content) | New content = widget. The MCP path edits what's on disk. |

## How to render the editor widget

1. Take the **WIDGET HTML** block below verbatim.
2. Replace the literal token `__INITIAL_MARKDOWN__` (one occurrence, inside a `<textarea>`) with the draft. HTML-escape `& < > "` only — backticks, asterisks, brackets, slashes pass through.
3. Call `visualize:show_widget` with that HTML as `widget_code`. Use `title: "prose_editor"` and `loading_messages: ["Opening the editor"]`. Make the silent `read_me` call once per conversation if you haven't already.

In your reply after rendering, briefly state in one sentence what the widget contains and that they can edit and click **Open in Prose** when ready.

## WIDGET HTML

```html
<!-- WIDGET_HTML_BEGIN -->
<!-- (build:skill inlines resources/prose-artifact/prose-editor.html here) -->
<!-- WIDGET_HTML_END -->
```

## Open-in-Prose handoff

The widget's "Open in Prose" button calls `sendPrompt(text)` with this message:

```
Open this in Prose:

```markdown
<editor textarea contents at the moment of click>
```
```

When you receive a turn that begins with `Open this in Prose:` followed by a fenced markdown block:

1. Extract the body of the fenced block.
2. Infer a filename — first H1 slugified (`# Why I switched to SQLite` → `why-i-switched-to-sqlite.md`), or `draft.md` if no H1.
3. Call `create_and_open_file({ filename, content })`.
4. Reply with one line: *"Opened `<filename>` in Prose."* Don't echo the markdown.

If `create_and_open_file` isn't available (MAS build, web mode, MCP not installed) or fails (Prose not running and the bridge can't auto-launch), reply: *"I couldn't reach Prose to open this. Copy the markdown from the editor and paste it into a new Prose document."* Don't retry.

## When to use the widget vs inline markdown

Render the widget for any self-contained markdown document — README, post, essay, notes, draft, blog post, email, list, plan, anything with headings or multiple paragraphs.

Inline markdown only for: short conversational replies (a sentence or two), single code-block snippets in a conversational reply, direct lookup answers (*"how do I check disk usage on Linux?"*).

When in doubt, render the widget. Drafts that live only inline are hard to keep iterating on.

**Exception**: if the user has a markdown file open in Prose and is asking you to work on *that document*, use the MCP path (`read_document` → `suggest_edit`) instead. Don't fork their open document into a separate widget.

## Connectivity (MCP path only)

Don't probe — your first MCP call doubles as the check. Read the response state:

- Expected payload → MCP is connected. Continue.
- "tool not found" → MCP isn't installed. Tell the user: open Prose → Settings → Integrations → click "Install MCP Server", then restart Claude.
- Connection refused → MCP installed but Prose isn't running. Ask the user to launch it.
- Mac App Store build → MCP unavailable by sandbox design. Offer pasted-content workflow; don't suggest install.

If MCP isn't usable, surface why and offer an alternative.

## MCP tools

| Tool | Purpose |
|------|---------|
| `get_outline` | Returns headings: `{ outline: [{ level, text, line }, ...], summary? }`. `summary` only appears for documents with fewer than 3 headings. |
| `read_document` | Returns `{ nodes: [{ id, type, content }, ...], markdown }`. **Note**: nodes carry `content`, not `text`. |
| `suggest_edit` | `{ nodeId (req), content (req), comment?, search? }` → `{ suggested: true, suggestionId }`. User accepts/rejects in Prose. Always pass `search` (the original node text) so the server can match if `nodeId` is stale. |
| `open_file` | Opens a file by absolute path. |
| `create_and_open_file` | Writes a file (default save dir, auto-suffixes on collision) and opens it. `filename` is just a name, not a path. |

`get_outline` and `read_document` are read-only. `create_and_open_file` and `open_file` switch the active document and dismiss any pending `suggest_edit` overlay — render diffs LAST in multi-tool flows. The MCP exposes only these 5 tools; there's no "get current file path".

## Editing nodes

`suggest_edit` is node-targeted. Workflow: `read_document` → pick the nodes → call `suggest_edit` for each one (with both `nodeId` and `search`). **Fire all your edits in a single response** — each call adds an independent suggestion mark to the document, and the user reviews the whole batch in Prose's review UI. Don't synchronously wait for the user to accept/reject between calls; just queue them and return.

**After each `suggest_edit` call, render a diff widget** (template in *Diff widget* below). This is a hard rule, not optional — even for a batch, render one diff widget per edit so the user can see what's being proposed in the chat alongside Prose's review overlay. The Prose review UI is the accept/reject surface; the chat-side diff widgets are the *visibility* surface. Both are needed.

Prefer minimal diffs (smallest containing node). For heading edits, verify the heading text verbatim against `get_outline` first. If `suggest_edit` returns "no match", re-read the document and retry with a fresh `nodeId`.

## Outline + diff widgets (for MCP work)

Both render via `visualize:show_widget` — same `read_me` prerequisite, same `title` / `loading_messages` parameters. The widget IS the response shape; don't fall back to plain Markdown unless `show_widget` is genuinely unavailable.

### Outline widget

After `get_outline` returns three or more entries. (For fewer than 3, use the `summary` field and answer in 1–2 conversational sentences.)

Substitute `{{HEADING_ITEMS}}` with one item per heading:

```html
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  .prose-outline {
    --bg: #ffffff; --text: #1a1a1a; --border: #e4e4e7; --muted: #71717a;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.6; color: var(--text); max-width: 720px;
  }
  @media (prefers-color-scheme: dark) {
    .prose-outline { --bg: #18181b; --text: #fafafa; --border: #3f3f46; --muted: #a1a1aa; }
  }
  .prose-outline__card { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; background: var(--bg); }
  .prose-outline__label { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px; }
  .prose-outline__item { padding: 3px 0; color: var(--text); font-size: 13px; }
</style>
<div class="prose-outline">
  <div class="prose-outline__card">
    <div class="prose-outline__label">Outline</div>
    {{HEADING_ITEMS}}
  </div>
</div>
```

Per-heading item — `INDENT` = `(level - 1) * 16`, `TEXT` = HTML-escape:

```html
<div class="prose-outline__item" style="padding-left: {{INDENT}}px;">{{TEXT}}</div>
```

### Diff widget

After `suggest_edit` returns success. Render every time, not just for "interesting" edits.

Compute an inline word-level diff between the original node text and your new `content`. Both texts appear in full, side-by-side, with only the differing word runs highlighted in place. Word-level granularity (a contiguous run of word characters or punctuation) — for `integraton` → `integration`, mark the whole word, not just the missing letter. Whole-paragraph rewrites where every word changed can mark the entire text as one span.

Substitute `{{OLD_TEXT}}`, `{{NEW_TEXT}}`, `{{COMMENT_BLOCK}}`:

```html
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  .prose-diff {
    --bg: #ffffff; --text: #1a1a1a; --border: #e4e4e7; --muted: #71717a; --surface: #f4f4f5;
    --removed-bg: #fecaca; --removed-fg: #7f1d1d;
    --added-bg: #bbf7d0; --added-fg: #14532d;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.55; color: var(--text); max-width: 820px;
  }
  @media (prefers-color-scheme: dark) {
    .prose-diff {
      --bg: #18181b; --text: #fafafa; --border: #3f3f46; --muted: #a1a1aa;
      --surface: rgba(255, 255, 255, 0.04);
      --removed-bg: rgba(239, 68, 68, 0.30); --removed-fg: #fecaca;
      --added-bg: rgba(34, 197, 94, 0.30); --added-fg: #bbf7d0;
    }
  }
  .prose-diff__columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .prose-diff__col { display: flex; flex-direction: column; min-width: 0; }
  .prose-diff__label { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
  .prose-diff__block { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; background: var(--bg); flex: 1; }
  .prose-diff__text { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; color: var(--text); }
  .prose-diff__removed { background: var(--removed-bg); color: var(--removed-fg); text-decoration: line-through; text-decoration-thickness: 1px; padding: 0 2px; border-radius: 3px; }
  .prose-diff__added { background: var(--added-bg); color: var(--added-fg); padding: 0 2px; border-radius: 3px; }
  .prose-diff__comment { margin-bottom: 16px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: 13px; color: var(--text); }
  .prose-diff__footer { font-size: 12px; color: var(--muted); }
</style>
<div class="prose-diff">
  <div class="prose-diff__columns">
    <div class="prose-diff__col">
      <div class="prose-diff__label">Original</div>
      <div class="prose-diff__block"><pre class="prose-diff__text">{{OLD_TEXT}}</pre></div>
    </div>
    <div class="prose-diff__col">
      <div class="prose-diff__label">Suggested</div>
      <div class="prose-diff__block"><pre class="prose-diff__text">{{NEW_TEXT}}</pre></div>
    </div>
  </div>
  {{COMMENT_BLOCK}}
  <div class="prose-diff__footer">Accept or reject in Prose's diff overlay.</div>
</div>
```

`{{OLD_TEXT}}` — full original text HTML-escaped, then wrap each removed run in `<span class="prose-diff__removed">…</span>`. Unchanged text stays unmarked. `{{NEW_TEXT}}` — same idea with `prose-diff__added`. Unchanged text in OLD_TEXT and NEW_TEXT must match exactly.

`{{COMMENT_BLOCK}}` — empty when no `comment`. When present:
```html
<div class="prose-diff__comment">{{COMMENT}}</div>
```
with `{{COMMENT}}` HTML-escaped.

After rendering the diff, briefly state what the change does (one sentence). Then wait for the user.

## Graceful degradation

| Condition | Behavior |
|-----------|----------|
| Prose running, MCP connected | Full assistance. |
| Prose running, MCP not installed (OSS build) | "Open Prose → Settings → Integrations → Install MCP Server, then restart Claude." |
| Mac App Store build | Sandbox blocks MCP. Offer pasted content. Don't suggest install. |
| Prose not running | Suggest launching, or work with pasted content. |
| `show_widget` unavailable on this surface | Outline → nested Markdown list (use `level` for indent). Diff → describe in 1–2 sentences. |
