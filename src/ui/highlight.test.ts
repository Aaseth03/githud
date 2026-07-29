import { describe, expect, it } from "vitest";
import { highlight, languageFor } from "./highlight";

describe("choosing a grammar", () => {
  it("recognises the languages this project is written in", () => {
    expect(languageFor("src/main.rs")).toBe("rust");
    expect(languageFor("ui/App.tsx")).toBe("typescript");
    expect(languageFor("Cargo.toml")).toBe("ini");
    expect(languageFor("package.json")).toBe("json");
    expect(languageFor("AGENTS.md")).toBe("markdown");
    expect(languageFor("ops/scripts/run.sh")).toBe("bash");
  });

  it("identifies files by name where they have no extension", () => {
    expect(languageFor("Dockerfile")).toBe("bash");
    expect(languageFor("path/to/Makefile")).toBe("bash");
    expect(languageFor(".gitignore")).toBe("bash");
  });

  it("is case-insensitive", () => {
    expect(languageFor("README.MD")).toBe("markdown");
    expect(languageFor("DOCKERFILE")).toBe("bash");
  });

  it("returns nothing for an unknown type rather than guessing", () => {
    // Auto-detection colours a file confidently and wrongly; no highlighting
    // reads better than highlighting that is lying.
    expect(languageFor("data.bin")).toBeNull();
    expect(languageFor("notes.xyz")).toBeNull();
    expect(languageFor("LICENSE")).toBeNull();
  });

  it("ignores a dot that is not an extension", () => {
    expect(languageFor(".")).toBeNull();
    expect(languageFor("src/")).toBeNull();
  });

  it("uses the file's own extension, not a directory's", () => {
    expect(languageFor("some.rs.dir/notes")).toBeNull();
    expect(languageFor("some.dir/main.rs")).toBe("rust");
  });
});

describe("highlighting", () => {
  it("marks up code it understands", () => {
    const html = highlight("fn main() {}", "a.rs");

    expect(html).toContain("hljs-");
    expect(html).toContain("main");
  });

  it("returns nothing for an unknown type, so the caller shows plain text", () => {
    expect(highlight("some text", "notes.xyz")).toBeNull();
  });

  it("escapes markup so file contents cannot inject HTML", () => {
    // The output is rendered as HTML; unescaped content would be an injection
    // from any file the tree can open.
    const html = highlight('let x = "<img src=x onerror=alert(1)>";', "a.rs");

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("survives content that does not parse as the language", () => {
    // A `.rs` file mid-edit is often not valid Rust.
    expect(() => highlight("fn ((( unclosed", "a.rs")).not.toThrow();
    expect(highlight("fn ((( unclosed", "a.rs")).not.toBeNull();
  });

  it("handles an empty file", () => {
    expect(highlight("", "a.rs")).toBe("");
  });
});
