import { describe, expect, it } from "bun:test";
import { anchorPillHtml, escapeHtml, shortHash } from "../web/src/lib/format.js";
import type { AnchorRecord } from "../web/src/lib/types.js";

const FULL_ROOT = "0x574aaf45e85ddcccac847ab6ebfbbd24c52f99bfa8034d4199d2fab660bd3901";
const FULL_TX = "0xac7e0e7331ef99766e9ffc6ebfb5f6da2701fe64087824b2b4f91d04ceb58a17";

describe("shortHash", () => {
  it("returns an empty string for null / undefined", () => {
    expect(shortHash(null)).toBe("");
    expect(shortHash(undefined)).toBe("");
  });

  it("returns an empty string for an empty input", () => {
    expect(shortHash("")).toBe("");
  });

  it("truncates a 66-char rootHash to 8-char prefix + … + 6-char suffix", () => {
    const out = shortHash(FULL_ROOT);
    expect(out.startsWith("0x")).toBe(true);
    expect(out).toContain("…");
    expect(out.length).toBe(15); // "0x574aaf" + "…" + "bd3901"
    expect(out.startsWith("0x574aaf")).toBe(true);
    expect(out.endsWith("bd3901")).toBe(true);
  });

  it("prefixes 0x when the input is missing it", () => {
    const out = shortHash("574aaf45e85ddcccac847ab6ebfbbd24c52f99bfa8034d4199d2fab660bd3901");
    expect(out.startsWith("0x")).toBe(true);
  });

  it("returns short inputs unchanged", () => {
    expect(shortHash("0x1234")).toBe("0x1234");
    expect(shortHash("0x12345678")).toBe("0x12345678");
  });
});

describe("anchorPillHtml", () => {
  it("renders the not-anchored marker when the anchor is undefined", () => {
    const html = anchorPillHtml(undefined);
    expect(html).toContain("anchor-missing");
    expect(html).toContain("— not anchored");
    expect(html).not.toContain("anchor-pill");
  });

  it("renders the not-anchored marker when rootHash is empty", () => {
    const html = anchorPillHtml({ rootHash: "", txHash: FULL_TX });
    expect(html).toContain("anchor-missing");
  });

  it("links to chainscan-galileo for the storage tx when both hashes are present", () => {
    const html = anchorPillHtml({ rootHash: FULL_ROOT, txHash: FULL_TX });
    expect(html).toContain('class="anchor-pill"');
    expect(html).toContain("chainscan-galileo.0g.ai/tx/");
    expect(html).toContain(FULL_TX);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("falls back to storagescan when txHash is missing", () => {
    const html = anchorPillHtml({ rootHash: FULL_ROOT, txHash: "" });
    expect(html).toContain("storagescan-galileo.0g.ai/tx/");
    expect(html).toContain(FULL_ROOT);
  });

  it("renders the truncated rootHash inside the pill", () => {
    const html = anchorPillHtml({ rootHash: FULL_ROOT, txHash: FULL_TX });
    expect(html).toContain("0x574aaf45");
    expect(html).toContain("d3901");
    expect(html).toContain("…");
  });

  it("escapes HTML so injected tags cannot break out into the DOM", () => {
    const evil: AnchorRecord = {
      rootHash: '0x"><script>alert(1)</script>',
      txHash: '0x"<img src=x onerror=alert(2)>',
    };
    const html = anchorPillHtml(evil);
    // No raw `<script` or `<img` HTML opening can leak into the parsed DOM.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    // The unsafe metacharacters that would terminate an attribute have been escaped.
    expect(html).not.toContain('"><script');
    expect(html).not.toContain('"<img');
    // And the escaped form is what reaches the title attribute.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    // The href is URL-encoded, so even raw chevrons round-trip safely.
    expect(html).toContain("%3C"); // encoded `<`
    expect(html).toContain("%3E"); // encoded `>`
  });

  it("preserves the 0G label and accent classes", () => {
    const html = anchorPillHtml({ rootHash: FULL_ROOT, txHash: FULL_TX });
    expect(html).toContain('class="anchor-pill-label"');
    expect(html).toContain(">0G<");
    expect(html).toContain('class="anchor-pill-hash"');
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >, \", and '", () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("coerces non-string input to string", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(null)).toBe("null");
    expect(escapeHtml(undefined)).toBe("undefined");
  });
});
