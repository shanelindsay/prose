# Prose Skill + Widget Architecture

How the Prose-in-Claude skill drives the editor widget and the MCP path, and the platform constraints we discovered building it. Captures lessons from issues #435, #437, #443, #444, #445, #451 — should save future skill work from re-discovering the same dead ends.

**Key files:** `resources/prose-skill/prose/SKILL.md`, `resources/prose-artifact/prose-editor.html`, `scripts/build-skill.mjs`, `src/main/index.ts` (`prose://` handler), `src/renderer/lib/tools/executors/editor.ts` (`suggest_edit`, `create_and_open_file`).

---

## The four widget tiers

Claude has four tiers for rendering interactive UI in chat, fastest to slowest. We only have access to two.

| Tier | Mechanism | Render speed | Available to us? |
|------|-----------|--------------|------------------|
| 1. Native client widgets | Anthropic-built React components keyed to internal tool names (`message_compose_v1`, `recipe_display_v0`, etc.). Model emits ~200 bytes of JSON; the client mounts a pre-loaded component. | Instant | **No** — Anthropic-owned, third parties cannot register new ones. |
| 2. `visualize:show_widget` | Model streams full HTML/JS as `widget_code`; client renders inline in chat with no iframe chrome. | Fast (size-bound by streaming) | **Yes** — this is the editor / outline / diff path. |
| 3. HTML / React artifacts | Full iframe-bound document in the artifact pane. Persistent across turns. | Slow (iframe boundary, mount cost) | Yes, but rejected — iframe sandbox blocks the prose:// handoff. |
| 4. MCP-rendered UI | MCP server returns structured data; client has a renderer keyed to that tool's response shape (Todoist, Slack, Calendar). | Tier-1 speed | Partner-integrated only — no public API for third parties yet. |

Practical implication: anything we want to render in chat lives at Tier 2. The streaming budget is real — every byte of `widget_code` is a token Claude has to emit. Smaller widget = faster appearance.

## The `sendPrompt` primitive

`visualize:show_widget` widgets get a global `sendPrompt(text)` function injected into their iframe. Calling it **injects a turn into the conversation as if the user typed it** — Claude receives the next message and can act on it.

This is the lever we use for the Open-in-Prose handoff. The widget's button calls `sendPrompt('Open this in Prose:\n\n```markdown\n<content>\n```')`; Claude parses that turn and calls `create_and_open_file` MCP. The widget never has to reach outside the iframe — Claude bridges.

This is **not documented anywhere public**. It's surfaced only through example skills (we found it in the `organize-prioritize` skill's triage widget). If you're building a new skill that needs widget→action interactivity, this is your tool.

## Why `prose://` deep-link from inside the iframe doesn't work

Claude Desktop and claude.ai web both restrict iframe navigation to `http://` and `https://` schemes. `<a href="prose://...">` from inside a widget or artifact iframe silently white-screens the iframe and never reaches the OS. Confirmed via testing and matches `anthropics/claude-code#26952`.

The deep-link does still work for **non-iframe surfaces** — CLI (`open prose://...`), downloaded `.html` opened in a browser, or any external app. We keep the handler chain alive in `src/main/index.ts` for those cases.

For the in-widget handoff, **use `sendPrompt` → MCP**. Don't try to make `prose://` work from inside a widget; it can't.

## Round-trip optimization

The slowest path is when Claude has to make several `Read` / `Bash` tool calls before `show_widget` fires. Each tool call is its own model turn with its own latency.

We compressed from ~6 calls down to 2 by:

1. **Inlining the widget HTML inside SKILL.md** at `<!-- WIDGET_HTML_BEGIN -->` / `<!-- WIDGET_HTML_END -->` sentinels. `scripts/build-skill.mjs` substitutes the widget body in at build time. Claude reads SKILL.md once at skill activation and the widget body comes along for free — no separate `Read prose-editor.html` needed.
2. **A single placeholder substitution** (`__INITIAL_MARKDOWN__`) inside the widget's `<textarea>`. Claude does one in-string replacement before calling `show_widget`. No `bash sed` substitution, no temp file dance.
3. **Section ordering matters.** Templates (widget HTML, diff widget HTML) must appear in SKILL.md **before** the rules that reference them. Claude reads sequentially and won't render a template it hasn't seen yet — even if a later instruction tells it to.
4. **One widget per batch, not one per call.** When Claude makes 10 `suggest_edit` calls, render ONE summary diff widget at the end with 10 rows. Streaming 10 separate widget HTML payloads kills perceived speed.

## Theming widgets that adapt to the host

`@media (prefers-color-scheme: dark)` does not propagate cleanly into the `show_widget` iframe — the body might pick up dark mode but the toolbar won't, etc.

Use claude.ai's **CSS custom properties** instead. The widget iframe injects:

- `--color-background-primary` / `--color-background-secondary`
- `--color-text-primary` / `--color-text-secondary` / `--color-text-tertiary`
- `--color-border-secondary` / `--color-border-tertiary`
- `--color-text-warning`
- `--border-radius-md`

These flip automatically with the host theme. Our editor and diff widgets use them with hardcoded light-mode fallbacks for safety.

## SKILL.md structure that worked

Order the file by what Claude needs first:

1. Frontmatter (activation triggers — load-bearing).
2. `# Prose` one-line intro.
3. **Quick reference** (table that decides editor-widget vs MCP path).
4. **How to render the editor widget** (substitution steps).
5. **WIDGET HTML** sentinel block (inlined at build time).
6. **Open-in-Prose handoff contract** (parsing the `sendPrompt` message → `create_and_open_file` MCP).
7. **When to use widget vs inline** (heuristic).
8. MCP path detail: Connectivity, Tools, Outline + diff widget templates, Editing nodes workflow.
9. Graceful degradation table.

Critically: the **diff widget template comes before the Editing nodes section that requires it**. Otherwise Claude reads "render a diff widget" before it has the template, doesn't have the template in its read window, and silently skips rendering.

## Override the platform default — Document · MD

Without explicit instruction, Claude defaults to claude.ai's built-in `Document · MD` artifact for any markdown content (it's the platform-level default). The skill must *explicitly* tell Claude not to: *"render the prose-editor widget instead. Do NOT create a Document · MD artifact."* Putting this directive in the **first row of the Quick reference table** ensures Claude sees it before deciding how to respond.

## Artifact iframe constraints (lessons from the abandoned approach)

We initially built the editor as an HTML artifact (Tier 3). We abandoned it because:

- **Download blocked**: claude.ai's artifact iframe sandbox lacks `allow-downloads`. Both `anchor.click()` and `window.open(blob:)` fallbacks fail silently.
- **Open in Prose chrome label tied to file extension**: the artifact pane's "Open in [App]" button uses the OS default-app for the artifact's file extension. Our artifact saved as `.html` so it opened in the user's default browser, not Prose. Unfixable without registering Prose globally as the `.html` handler (worse than the status quo).
- **`prose://` navigation blocked** (see above section).

The widget pivot resolved all three: widgets render inline (no artifact pane chrome), no download requirement (Copy markdown handles it), no `prose://` need (sendPrompt → MCP handles handoff).

## File checklist for new skill+widget work

If you're adding a new widget to an existing skill or building a new skill:

- [ ] Define the widget HTML with claude.ai CSS variables (`var(--color-text-primary, #fallback)` etc.)
- [ ] Use a single literal placeholder for any dynamic content (e.g., `__INITIAL_MARKDOWN__`)
- [ ] Inline the widget HTML into SKILL.md via a sentinel block + build-time substitution
- [ ] Order SKILL.md sections so templates come *before* the rules that reference them
- [ ] If the widget needs to trigger a Claude action, design a structured `sendPrompt` message — don't try to navigate or call MCP from inside the widget
- [ ] Write the parsing rules for the `sendPrompt` message in SKILL.md, including a graceful-failure path when MCP isn't available
- [ ] For batch operations: one summary widget per batch, never N widgets per N items
- [ ] Activation triggers (frontmatter `description`) and override directives (Quick reference) are load-bearing — don't trim them when slimming the skill
