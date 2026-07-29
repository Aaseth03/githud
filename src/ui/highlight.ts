/**
 * Syntax highlighting for the file viewer.
 *
 * Only the languages this machine actually contains are registered — the full
 * highlight.js bundle is an order of magnitude larger than the viewer that
 * needs it, and a HUD should not pay for 190 grammars to read a `.rs` file.
 */

import hljs from "highlight.js/lib/core";

import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, lang] of [
  ["bash", bash],
  ["css", css],
  ["diff", diff],
  ["go", go],
  // TOML shares ini's grammar in highlight.js.
  ["ini", ini],
  ["javascript", javascript],
  ["json", json],
  ["markdown", markdown],
  ["python", python],
  ["rust", rust],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
] as const) {
  hljs.registerLanguage(name, lang);
}

/** Extension → registered grammar. */
const BY_EXTENSION: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  go: "go",
  css: "css",
  html: "xml",
  xml: "xml",
  svg: "xml",
  patch: "diff",
  diff: "diff",
};

/** Files whose name, not extension, identifies them. */
const BY_NAME: Record<string, string> = {
  dockerfile: "bash",
  makefile: "bash",
  ".gitignore": "bash",
  ".bashrc": "bash",
  ".zshrc": "bash",
};

/**
 * Which grammar to use, or `null` for none.
 *
 * Deliberately does *not* fall back to highlight.js's auto-detection: guessing
 * wrong colours a file confidently and misleadingly, and no highlighting reads
 * better than highlighting that is lying.
 */
export function languageFor(path: string): string | null {
  const name = (path.split("/").pop() ?? "").toLowerCase();

  if (BY_NAME[name]) return BY_NAME[name]!;

  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

/**
 * Highlight `code`, returning HTML.
 *
 * Returns `null` when the language is unknown or highlighting fails, so the
 * caller renders plain text rather than risking mangled output.
 */
export function highlight(code: string, path: string): string | null {
  const language = languageFor(path);
  if (!language) return null;
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
