# Prose v1.1.0

Prose now goes wherever you write, edit, and take notes, from reMarkable notebook to inside Claude.

## What's New

### Prose in Claude

- `prose://` **URL scheme** — open files in Prose from anywhere
- **Prose markdown editor widget** — edit markdown directly in a Claude conversation; round-trip drafts between Claude and Prose without losing your place
- Support for Outline and Suggested Edit diff review in Claude with widgets
- **Prose Skill** — bundled Claude skill that turns Claude into a Prose-aware writing collaborator. Download from Help → Download Prose Skill, the toolbar, or Settings → Integrations.
- **Two-step consent flow** — clear, no-AI-required onboarding for users

### reMarkable Sync GA

- Sync your reMarkable notebooks from the Cloud via reMarkable Connect
- Convert handwritten notes to markdown using open-source reMarkable conversion Lambda
- **Page-level incremental OCR** — re-OCR only what changed
- **Per-notebook sync indicators** in the file explorer
- **Parallel page sync** with real-time progress
- **Failure handling** — surface OCR failure state, auto-retry transient OCR failures on the next sync (30-min staleness window), manual "Retry Sync" + "Report OCR Issue" context menu
- **Cancel in-progress sync** — bail out cleanly when a sync is taking too long
- **"Move to…"** for synced notebooks, sharing the same folder picker as Manage Notebooks
- **Sync folder moves to reMarkable Connect** — folder reorganizations now round-trip

### Security

- **CVE cleanup** — `hono` and `fast-uri` overrides clear 7 transitive CVEs
- Sanitization, SRI hashes, and race fixes throughout the artifact editor

## Installation

### Direct Download

Download `Prose-1.1.0-arm64.dmg`, open, and drag to Applications. The app is signed and notarized — no security bypass needed.

### Auto-Update

Existing users will be prompted to update automatically.

### Mac App Store

A matching v1.1.0 build will follow on the Mac App Store.

## Requirements

- macOS (Apple Silicon)
- Anthropic API key for AI features ([get one](https://console.anthropic.com/))

---

**Full changelog:** https://github.com/solo-ist/prose/compare/v1.0.1...v1.1.0