import type { AnchorRecord, PolicyRules, ValidationError, Verdict } from "./types.js";

export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

const REASON_TRUNCATE = 200;
export function renderReason(text: string): string {
  const s = String(text);
  if (s.length <= REASON_TRUNCATE) return escapeHtml(s);
  const head = s.slice(0, REASON_TRUNCATE);
  return `<details><summary>${escapeHtml(head)}…</summary><pre>${escapeHtml(s)}</pre></details>`;
}

export function summarizeZodIssues(data: unknown): string {
  const v = data as ValidationError | null | undefined;
  if (!v || v.error !== "ValidationError" || !Array.isArray(v.issues)) return "";
  const items = v.issues
    .map((iss) => {
      const path = (iss.path ?? []).join(".") || "(root)";
      return `<li><code>${escapeHtml(path)}</code> — ${escapeHtml(iss.message ?? iss.code ?? "")}</li>`;
    })
    .join("");
  return `<div>Validation failed:</div><ul>${items}</ul>`;
}

export function formatRules(r: PolicyRules): string {
  const parts: string[] = [];
  if (r.maxTransferEth !== undefined) parts.push(`maxTransferEth=${r.maxTransferEth}`);
  if (r.maxDailyOutflowEth !== undefined) parts.push(`maxDailyOutflowEth=${r.maxDailyOutflowEth}`);
  if (r.allowedDestinations?.length) parts.push(`allow=[${r.allowedDestinations.length}]`);
  if (r.forbiddenSelectors?.length) parts.push(`forbid=[${r.forbiddenSelectors.length}]`);
  return parts.join(" · ") || "no rules";
}

export function gaugeSvg(score: number): string {
  const len = 157;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = len - (clamped / 100) * len;
  return (
    '<svg viewBox="0 0 120 70">' +
    '<path class="arc-bg" d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke-width="3"/>' +
    '<path class="arc-fg" d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke-width="3" ' +
    `stroke-dasharray="${len}" stroke-dashoffset="${offset}" stroke-linecap="round" ` +
    'style="transition: stroke-dashoffset 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);"/>' +
    "</svg>"
  );
}

export type VerdictKlass = "allow" | "block" | "confirm";

export function verdictKlass(v: Verdict): VerdictKlass {
  if (v === "ALLOW") return "allow";
  if (v === "BLOCK") return "block";
  return "confirm";
}

export function verdictWord(v: Verdict): string {
  if (v === "ALLOW") return "Allowed";
  if (v === "BLOCK") return "Blocked";
  return "Confirm";
}

export function shortHash(h: string | undefined | null): string {
  if (!h || typeof h !== "string") return "";
  const s = h.startsWith("0x") ? h : `0x${h}`;
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

const STORAGESCAN = "https://storagescan-galileo.0g.ai";
const CHAINSCAN = "https://chainscan-galileo.0g.ai";

/**
 * Pill state for a row that has been written to the in-memory cache but
 * whose 0G anchor is still uploading in the background. Shown while the
 * frontend polls /policies/:id for the anchor to land. Pulsing accent dot
 * + "anchoring" text — no link yet because there's no rootHash to point
 * at. The CSS animation lives in `.anchor-pill-pending` in global.css.
 */
export function anchorPendingPillHtml(): string {
  return (
    '<span class="anchor-pill anchor-pill-pending" title="Anchoring decision on 0G Galileo testnet — typically 5-15s">' +
    '<span class="anchor-pill-label">0G</span>' +
    '<span class="anchor-pill-hash">anchoring</span>' +
    "</span>"
  );
}

/**
 * Returns trusted HTML that is safe to insert via `innerHTML`.
 *
 * The output escapes user-controlled bytes from `anchor.rootHash` and
 * `anchor.txHash` in three places:
 *   - the visible truncated hash (`shortHash` + `escapeHtml`)
 *   - the `title=` tooltip (`escapeHtml`)
 *   - the `href=` URL (`encodeURIComponent` + `escapeHtml`)
 *
 * Callers SHOULD assemble the result into a larger HTML string and assign it
 * via `innerHTML`. They MUST NOT inject untrusted content alongside the pill
 * without their own escaping.
 */
export function anchorPillHtml(anchor: AnchorRecord | undefined): string {
  if (!anchor || !anchor.rootHash) {
    return '<span class="anchor-missing">— not anchored</span>';
  }
  const root = escapeHtml(shortHash(anchor.rootHash));
  const tooltip = escapeHtml(
    `0G Storage anchor\nrootHash: ${anchor.rootHash}\ntxHash:   ${anchor.txHash}\n\nClick to open on chainscan-galileo.0g.ai`,
  );
  const txUrl = anchor.txHash
    ? `${CHAINSCAN}/tx/${encodeURIComponent(anchor.txHash)}`
    : `${STORAGESCAN}/tx/${encodeURIComponent(anchor.rootHash)}`;
  return `<a class="anchor-pill" href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer" title="${tooltip}"><span class="anchor-pill-label">0G</span><span class="anchor-pill-hash">${root}</span></a>`;
}
