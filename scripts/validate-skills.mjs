#!/usr/bin/env node
// Validate every skills/<name>/SKILL.md so a malformed skill can't be committed/published.
//
// Uses the SAME frontmatter parser the `npx skills add` installer uses (gray-matter), so "passes
// this check" == "the installer will discover it". The bug this guards against: an unquoted YAML
// `description:` that contains a `: ` (colon-space) — YAML reads the pre-colon text as a mapping key
// and throws "incomplete explicit mapping pair", so gray-matter yields no name/description and the
// installer SILENTLY skips the skill. Quote the value (or use a block scalar) to fix.
//
// Hard errors (exit 1): missing SKILL.md, frontmatter that doesn't parse, missing/empty name or
// description, name not matching the directory, name not matching the Agent-Skills format.
// Warnings (exit 0): description over the 1024-char Agent-Skills guideline.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(repoRoot, 'skills');

// Agent-Skills frontmatter constraints.
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; // lowercase, digits, single hyphens
const NAME_MAX = 64;
const DESC_MAX = 1024;

const errors = [];
const warnings = [];

const dirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

if (dirs.length === 0) {
  errors.push('no skills found under skills/');
}

for (const name of dirs) {
  const skillMd = join(skillsDir, name, 'SKILL.md');
  if (!existsSync(skillMd) || !statSync(skillMd).isFile()) {
    errors.push(`${name}: missing SKILL.md`);
    continue;
  }

  let data;
  try {
    ({ data } = matter(readFileSync(skillMd, 'utf8')));
  } catch (e) {
    // The exact failure mode that silently breaks installation (e.g. unquoted `: ` in description).
    errors.push(`${name}: frontmatter does not parse — ${e.message.split('\n')[0]}`);
    continue;
  }

  const nm = data.name;
  if (typeof nm !== 'string' || nm.trim() === '') {
    errors.push(`${name}: missing or empty 'name'`);
  } else {
    if (nm !== name) errors.push(`${name}: 'name: ${nm}' must match the directory name '${name}'`);
    if (nm.length > NAME_MAX) errors.push(`${name}: 'name' is ${nm.length} chars (max ${NAME_MAX})`);
    if (!NAME_RE.test(nm)) {
      errors.push(`${name}: 'name' must be lowercase letters/digits/hyphens (got '${nm}')`);
    }
  }

  const desc = data.description;
  if (typeof desc !== 'string' || desc.trim() === '') {
    errors.push(`${name}: missing or empty 'description'`);
  } else if (desc.length > DESC_MAX) {
    warnings.push(`${name}: description is ${desc.length} chars (Agent-Skills guideline is ${DESC_MAX})`);
  }
}

for (const w of warnings) console.warn(`⚠️  ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`❌ ${e}`);
  console.error(`\n${errors.length} skill(s) invalid.`);
  process.exit(1);
}
console.log(`✅ ${dirs.length} skill(s) valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
