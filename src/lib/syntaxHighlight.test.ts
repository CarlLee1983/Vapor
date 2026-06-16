import { describe, expect, it } from "vitest";
import { languageForPath, highlightCode } from "./syntaxHighlight";

describe("languageForPath", () => {
  it("maps known extensions to highlight.js language names", () => {
    expect(languageForPath("src/app.ts")).toBe("typescript");
    expect(languageForPath("src/app.tsx")).toBe("typescript");
    expect(languageForPath("main.rs")).toBe("rust");
    expect(languageForPath("README.md")).toBe("markdown");
    expect(languageForPath("a/b/c.py")).toBe("python");
  });

  it("returns undefined for unknown or extensionless paths", () => {
    expect(languageForPath("Makefile")).toBeUndefined();
    expect(languageForPath("data.unknownext")).toBeUndefined();
    expect(languageForPath("")).toBeUndefined();
  });
});

describe("highlightCode", () => {
  it("wraps tokens in hljs spans for a known language", () => {
    const html = highlightCode("const x = 1;", "typescript");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("const");
  });

  it("HTML-escapes and does not tokenise when language is undefined", () => {
    expect(highlightCode("<b> & 'x'", undefined)).toBe("&lt;b&gt; &amp; 'x'");
  });

  it("HTML-escapes when language is not registered", () => {
    expect(highlightCode("<tag>", "definitely-not-a-lang")).toBe("&lt;tag&gt;");
  });
});
