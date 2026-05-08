---
name: prose
description: Drives Prose for markdown work. For ANY markdown content the user wants to draft, write, create, or edit in the conversation (a README, draft, essay, blog post, article, note, file, or any longform writing), render the bundled prose-editor.html as an inline widget via visualize:show_widget — NOT as a Document · MD / "Presented file" artifact. The widget replaces the built-in markdown artifact for this skill — Document · MD is read-only, the prose-editor widget is editable AND has a Save-to-Prose button that hands the draft off to the Prose desktop app via sendPrompt → create_and_open_file MCP. For documents the user has open in Prose, use Prose's MCP tools (get_outline, read_document, suggest_edit, open_file, create_and_open_file) instead. Activates whenever the user asks to draft, write, create, edit, restructure, summarize, outline, read, tighten, or polish markdown — or when Prose MCP tools are available in the session.
---

# Prose

Prose is a focused Markdown editor for macOS with native Claude integration via MCP (Model Context Protocol). This skill drives Prose from a Claude conversation: outlining documents, reading content, and proposing inline edits the user can accept or reject in the diff UI.

## Connectivity

Don't probe before doing real work — your **first MCP call doubles as the connectivity check**. Make whatever call the user's request actually needs (`get_outline`, `read_document`, etc.) and read the response state:

- **Returns the expected payload** → Prose is running with MCP connected. Continue.
- **"tool not found" / not in toolset** → MCP isn't installed. Tell the user: open Prose → Settings → Integrations → click "Install MCP Server", then restart Claude.
- **Error: server not reachable / connection refused** → MCP is installed but Prose isn't running. Ask the user to launch Prose, or offer to work with pasted content.
- **Mac App Store build of Prose** → MCP is unavailable by sandbox design. Explain this and offer to work with pasted content. Don't attempt install instructions.

Never silently underperform. If MCP isn't usable, surface why and offer an alternative.

## Tools

| Tool | Purpose |
|------|---------|
| `get_outline` | Returns document headings as a structured list. |
| `read_document` | Returns the full document as a list of nodes. Each node has an `id` (use this for edit targeting), the node `type`, and its `text` content. |
| `suggest_edit` | Proposes a replacement for a single node. The user sees an inline diff in Prose and accepts or rejects there — Prose's MCP does not expose programmatic accept. |
| `open_file` | Opens an existing file in Prose by absolute path. |
| `create_and_open_file` | Creates a new file with given content at a given path and opens it in Prose. |

## Response shapes

`get_outline` returns:

```
{ outline: [{ level: number, text: string, line: number }, ...], summary?: string }
```

Each entry is a heading. `level` is 1–6 (H1–H6), `text` is the heading text, `line` is its approximate line number. The `summary` field appears only when the document has fewer than 3 headings.

`read_document` returns `{ nodes: [{ id, type, content }, ...], markdown }`. The `id` is what `suggest_edit` targets via `nodeId`. `markdown` is the full document text if you need it without iterating nodes. **Note**: nodes carry `content`, not `text` — don't look for a `text` field.

`suggest_edit` returns `{ suggested: true, suggestionId }` on success.

## Side effects and limitations

- `create_and_open_file` and `open_file` switch the active document and dismiss any pending `suggest_edit` overlay. Order multi-tool flows accordingly: render the diff last if you want the user to land on it.
- `create_and_open_file` saves to Prose's configured default save location (typically `~/Documents`). The `filename` parameter is just a name, not a path; if it collides, Prose auto-suffixes (`Untitled.md` → `Untitled 2.md`).
- The MCP exposes only the 5 tools above — there is **no** "get current file path" tool. If you need the active document's path (e.g., to switch back after `create_and_open_file`), ask the user or use a path they've already mentioned. Don't guess.
- `get_outline` and `read_document` are read-only; safe to call any time without disturbing UI state.

## Editing

`suggest_edit` is **node-targeted**. Parameters:

- `nodeId` (**required**) — from `read_document`.
- `content` (**required**) — replaces the node's *entire* content.
- `comment` (optional) — short rationale shown in the diff UI (≤ 20 words).
- `search` (optional but recommended) — the original node text. Pass it whenever you have it; the server uses it as a text-match fallback if `nodeId` is stale.

Workflow: `read_document` → pick the node → `suggest_edit` with both `nodeId` and `search`. One call per turn — Prose's overlay handles one suggestion at a time. Don't loop waiting for accept/reject; just return.

If `suggest_edit` returns "node not found" / "no match", call `read_document` again, locate the node by its current text, and retry with the fresh `nodeId`.

Prefer minimal diffs — replace the smallest node that contains the change. When restructuring or editing headings, verify heading text verbatim against `get_outline` first.

## Rendering — widgets are the response shape

Both widget templates are inlined below. **The widget IS the response shape for outlines and diffs — not an optional enhancement.** Do not fall back to a Markdown list because the widget feels heavy or because Markdown is "simpler." Only fall back when `show_widget` is genuinely unavailable on this surface (every variant returns "tool not found").

### Calling `show_widget`

`show_widget` (also exposed as `visualize:show_widget`) requires three parameters:

- `widget_code` — the substituted HTML from the templates below.
- `title` — short snake_case identifier (e.g., `prose_outline`, `prose_diff_<short_node_id>`). No spaces or special characters; also used as the download filename.
- `loading_messages` — array of 1–4 short strings (~5 words each). Keep them dry and factual for this writing-tools context. Examples: `["Laying out the headings"]` for outline, `["Highlighting what changed"]` for diff.

The platform expects a `read_me` call **once silently** before your first `show_widget` call in the conversation. Don't narrate it — just make the call before rendering.

### Outline widget

**When**: after `get_outline` returns three or more entries. For fewer than 3 headings, use the `summary` field and answer in 1–2 conversational sentences.

**Outer template** — substitute `{{HEADING_ITEMS}}` with one item per heading:

```html
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  .prose-outline {
    --bg: #ffffff; --text: #1a1a1a; --border: #e4e4e7; --muted: #71717a;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.6; color: var(--text);
    max-width: 720px;
  }
  @media (prefers-color-scheme: dark) {
    .prose-outline { --bg: #18181b; --text: #fafafa; --border: #3f3f46; --muted: #a1a1aa; }
  }
  .prose-outline__card {
    border: 1px solid var(--border); border-radius: 8px;
    padding: 14px 16px; background: var(--bg);
  }
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

**Item template** — one per heading. `INDENT` = `(level - 1) * 16`. `TEXT` = HTML-escape `& < > "` in the heading text:

```html
<div class="prose-outline__item" style="padding-left: {{INDENT}}px;">{{TEXT}}</div>
```

Pass the substituted HTML as `widget_code` per the calling rules above.

### Diff widget

**When**: after `suggest_edit` returns `{ suggested: true, suggestionId }`. Render every time, not just for "interesting" edits.

**Compute** an inline word-level diff between the original node text and your new `content`. Both texts appear in full, side-by-side, with only the differing word runs highlighted in place — the eye skims unchanged surrounding text and lands on what changed.

**Granularity**: word-level (a contiguous run of word characters or a contiguous run of punctuation). Don't mark character-level differences inside a word — for `integraton` → `integration`, mark the whole word, not just the missing `i`. For whole-paragraph rewrites where every word changed, marking the entire text as one span is acceptable.

**Template** — substitute `{{OLD_TEXT}}`, `{{NEW_TEXT}}`, `{{COMMENT_BLOCK}}`:

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

**Substitution rules**:

- `{{OLD_TEXT}}` — full original text (HTML-escape `& < > "`), then wrap each removed run with `<span class="prose-diff__removed">…</span>`. Unchanged surrounding text stays unmarked.
- `{{NEW_TEXT}}` — full new text (HTML-escape first), then wrap each added run with `<span class="prose-diff__added">…</span>`. Unchanged text stays unmarked and matches the unmarked text in `{{OLD_TEXT}}` exactly.
- `{{COMMENT_BLOCK}}` — empty string when no `comment` was passed to `suggest_edit`. When present:

  ```html
  <div class="prose-diff__comment">{{COMMENT}}</div>
  ```

  with `{{COMMENT}}` HTML-escaped.

Pass the substituted HTML as `widget_code` per the calling rules above. Then in the conversational reply, briefly state what the change does (one sentence). Then wait for the user.

### When widgets really aren't available

If both `show_widget` and `visualize:show_widget` return "tool not found", render the same information as plain Markdown:

- Outline → nested list using `level` for indentation.
- Diff → describe the change in one or two sentences.

## Graceful degradation

| Condition | Behavior |
|-----------|----------|
| Prose running, MCP connected | Full assistance via MCP tools. |
| Prose running, MCP not installed (OSS build) | "Open Prose → Settings → Integrations → Install MCP Server, then restart Claude." |
| Mac App Store build of Prose | Sandbox blocks MCP. Offer pasted-content workflow. Don't suggest install. |
| Prose not running | Suggest launching, or work with pasted content. |

## Editor widget — the default surface for substantive markdown

The Prose editor is a lightweight markdown editor that renders **inline in the chat stream** as a widget via `visualize:show_widget` (same mechanism as the outline and diff widgets above). It is **the default presentation surface for any markdown content the user would plausibly want to read, edit, copy, or save** — not an opt-in, not a fallback, not a heuristic.

### Override the built-in Document · MD

When this skill is loaded, **render markdown via `visualize:show_widget`, not as a `Document · MD` / "Presented file" artifact.** Whenever you would otherwise create a markdown document artifact, render the prose-editor widget instead. The built-in is read-only; the widget is editable AND has a one-click handoff to Prose desktop (Save to Prose → sendPrompt → `create_and_open_file` MCP). The user installed this skill specifically to avoid the read-only fallback — honor that.

Do not skip the widget because the response is "just a draft" or feels short. That is exactly the case the widget is for: drafts the user wants to keep editing.

The widget's "Save to Prose" button calls `sendPrompt(...)` to push a structured turn into the chat. Claude (you) parse it and call `create_and_open_file` to hand the draft off to the desktop app where it persists. Full submission contract below.

### When to render

Render the editor widget whenever any of these are true:

- The user asks you to **draft, write, or create** any markdown content (a README, post, essay, notes, blog post, email, list, plan, doc).
- You are about to output a self-contained markdown document (anything with headings, multiple paragraphs, or anything the user would plausibly copy or save).

Inline markdown is reserved for:

- Short conversational replies (a sentence or two).
- Single code-block snippets where the surrounding prose is minimal.
- Direct lookup answers (*"how do I check disk usage on Linux?"*).

If you are uncertain whether a response is "substantive enough", render the widget. Drafts that live only inline are hard for the user to keep iterating on; the widget gives them an editable surface and a one-click handoff to Prose desktop.

**Exception — real files in Prose**: when the user has a markdown file open in Prose and is asking you to work on *that document*, use the MCP workflow (`read_document` → `suggest_edit`) instead. The widget is for *new* markdown content drafted in the conversation; the MCP path edits the user's existing files. Don't fork their open document into a separate widget.

### How to render

Read the file `prose-editor.html` from this skill bundle (sibling of `SKILL.md`). It is a self-contained single-file React widget. Pass its contents as the `widget_code` parameter to `visualize:show_widget` (same call shape as the outline and diff widgets — `read_me` once silently before the first `show_widget` call in the conversation, `title` snake-case, `loading_messages` array of 1–4 short strings).

Suggested call shape:

- `widget_code` — `prose-editor.html` contents with the seed placeholder substituted (see below).
- `title` — `prose_editor` (or `prose_editor_<short_topic>` if you want to disambiguate multiple widgets in one turn).
- `loading_messages` — a single short string, e.g. `["Opening the editor"]`.

**To seed initial content**, the file contains exactly one placeholder near the top:

```html
<script id="prose-initial-markdown" type="text/plain"></script>
```

Replace the empty body of that tag with the markdown text you want the editor to open with. **No JavaScript escaping** — the contents are inert plain text. Markdown special characters (backticks, asterisks, brackets, quotes) all pass through untouched. The only sequence to avoid inside the placeholder is `</script>`; if your draft contains a literal `</script>`, escape the slash to `<\/script>`.

Do not modify any other part of the file — not the React component, not the CDN scripts, not the SRI integrity hashes. Do not wrap the file in a `<!DOCTYPE html>` document. The single placeholder edit is the entire seam.

In your conversational reply after the widget renders, briefly state in one sentence what the widget contains and that they can edit and click **Save to Prose** when they're done.

### Save-to-Prose submission contract

When the user clicks the widget's **Save to Prose** button, the widget calls `sendPrompt(text)` with this exact message shape:

```
Save this draft to Prose:

```markdown
<current widget content verbatim>
```
```

The fence is the literal three-backtick `markdown` fence. The body is the editor textarea contents at the moment of click — possibly different from what you originally seeded, since the user may have edited.

**On receipt** (i.e. when you see a user turn that begins with `Save this draft to Prose:` followed by a fenced markdown block):

1. Extract the body of the fenced block as the draft content.
2. Infer a filename:
   - First H1 in the body → slugified to lowercase with hyphens, append `.md` (e.g. `# Why I switched to SQLite` → `why-i-switched-to-sqlite.md`).
   - No H1 → use `draft.md`.
3. Call `create_and_open_file({ filename: <inferred>, content: <body> })`.
4. In your reply, confirm in one sentence: *"Opened `<filename>` in Prose."* Don't echo the markdown content back; the user already has it.

If `create_and_open_file` fails (Prose not running and the stdio bridge can't auto-launch it; or the tool isn't exposed in the current session — MAS build, web mode, MCP not installed): respond conversationally, *"I couldn't reach Prose to save this. Copy the markdown from the editor and paste it into a new Prose document."* — and stop. Don't retry the tool.

### What the widget provides

- **Markdown textarea** — full-height editor seeded with your initial content, monospace font.
- **Word count** — updates live as the user types.
- **Copy markdown** — tries `navigator.clipboard` then falls back to a hidden-textarea `execCommand('copy')`.
- **Download** — saves the textarea content as `document.md`. Falls back to opening the blob in a new tab if the iframe sandbox blocks downloads.
- **Save to Prose** — the primary handoff. Calls `sendPrompt` with the structured message above.
- **Theme toggle** — light/dark; defaults to system preference.

The widget is intentionally minimal: vanilla JS, no external scripts, no React, no live preview. It is a focused drafting surface — the rendered view lives in Prose desktop, where the user lands after Save. Widgets are session-scoped (no `window.storage`), so the workflow is *draft → Save to Prose → keep editing in Prose where it persists.*
