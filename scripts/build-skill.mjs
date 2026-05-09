#!/usr/bin/env node
// Bundle resources/prose-skill/ into resources/prose.skill.
//
// Inlines resources/prose-artifact/prose-editor.html into SKILL.md between
// the <!-- WIDGET_HTML_BEGIN --> / <!-- WIDGET_HTML_END --> sentinels so
// Claude has the widget code in context the moment the skill activates —
// no extra Read or bash round trip before the visualize:show_widget call.

import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const stage = join(root, '.skill-build');
const stageProse = join(stage, 'prose');
const out = join(root, 'resources/prose.skill');
const skillSrc = join(root, 'resources/prose-skill/prose/SKILL.md');
const widgetSrc = join(root, 'resources/prose-artifact/prose-editor.html');

const BEGIN = '<!-- WIDGET_HTML_BEGIN -->';
const END = '<!-- WIDGET_HTML_END -->';

rmSync(out, { force: true });
rmSync(stage, { recursive: true, force: true });
mkdirSync(stageProse, { recursive: true });

const skill = readFileSync(skillSrc, 'utf8');
const widget = readFileSync(widgetSrc, 'utf8');

const beginIdx = skill.indexOf(BEGIN);
const endIdx = skill.indexOf(END);
if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
  console.error(`build-skill: missing or malformed sentinels in ${skillSrc}`);
  console.error(`  expected ${BEGIN} ... ${END}`);
  process.exit(1);
}

const inlined = skill.slice(0, beginIdx + BEGIN.length)
  + '\n' + widget.trimEnd() + '\n'
  + skill.slice(endIdx);

writeFileSync(join(stageProse, 'SKILL.md'), inlined);
copyFileSync(widgetSrc, join(stageProse, 'prose-editor.html'));

execSync('zip -rq ../resources/prose.skill prose/', { cwd: stage, stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
console.log(`Built ${out} (${inlined.length}-byte SKILL.md inlined)`);
