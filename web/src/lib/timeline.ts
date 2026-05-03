import { api } from "./api.js";
import {
  anchorPendingPillHtml,
  anchorPillHtml,
  escapeHtml,
  renderReason,
  verdictKlass,
  verdictWord,
} from "./format.js";
import { showJsonModal } from "./modal.js";
import type { Decision } from "./types.js";

declare global {
  interface Window {
    _timeline?: Decision[];
  }
}

/**
 * Decision ids whose 0G anchor upload is still in flight on the server.
 * Keyed by id, valued by `performance.now()` at submission time so the
 * shared poll loop can time out individual ids after
 * {@link ANCHOR_POLL_TIMEOUT_MS} without affecting other in-flight rows.
 * Set by `markDecisionPending` from the evaluate path; drained by
 * `loadTimeline` once the matching row's response carries a non-empty
 * rootHash.
 */
const pendingDecisionAnchors = new Map<string, number>();

const ANCHOR_POLL_INTERVAL_MS = 2_000;
const ANCHOR_POLL_TIMEOUT_MS = 30_000;

let pollingTimer: number | null = null;

/**
 * Mark a freshly created decision as awaiting its 0G anchor. The next
 * `loadTimeline()` render uses the pulsing "anchoring" pill instead of
 * the terminal "not anchored" marker, and a single shared polling loop
 * fetches /timeline every 2s for up to 30s per id, flipping each pill
 * to the lime "0G | 0xroot..." link the moment the anchor lands.
 */
export function markDecisionPending(id: string): void {
  pendingDecisionAnchors.set(id, performance.now());
  if (pollingTimer === null) startAnchorPolling();
}

function startAnchorPolling(): void {
  pollingTimer = window.setInterval(() => {
    const now = performance.now();
    for (const [id, start] of pendingDecisionAnchors) {
      if (now - start > ANCHOR_POLL_TIMEOUT_MS) pendingDecisionAnchors.delete(id);
    }
    if (pendingDecisionAnchors.size === 0) {
      if (pollingTimer !== null) {
        window.clearInterval(pollingTimer);
        pollingTimer = null;
      }
      void loadTimeline();
      return;
    }
    void loadTimeline();
  }, ANCHOR_POLL_INTERVAL_MS);
}

export async function loadTimeline(): Promise<void> {
  const r = await api<Decision[]>("GET", "/timeline");
  const rows = document.getElementById("timeline-rows");
  const empty = document.getElementById("timeline-empty");
  if (!rows || !empty) return;
  if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) {
    rows.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  window._timeline = r.data;

  for (const d of r.data) {
    if (pendingDecisionAnchors.has(d.id) && d.anchor && d.anchor.rootHash) {
      pendingDecisionAnchors.delete(d.id);
    }
  }

  rows.innerHTML = r.data
    .slice()
    .reverse()
    .map((d, idx) => {
      const klass = verdictKlass(d.verdict);
      const playbookCell = d.playbookTriggered
        ? `<div class="playbook-badge" style="margin:0;">playbook · ${escapeHtml(d.playbookTriggered.id.slice(0, 12))}… / ${escapeHtml(d.playbookTriggered.runId.slice(0, 10))}…</div>`
        : "";
      const rules = (d.rulesMatched ?? [])
        .map((x) => `<span class="badge">${escapeHtml(x)}</span>`)
        .join(" ");
      const reasons = (d.reasons ?? [])
        .map((rs) => `<div>→ ${renderReason(rs)}</div>`)
        .join("");
      const realIndex = (r.data as Decision[]).length - 1 - idx;
      const pillHtml =
        d.anchor && d.anchor.rootHash
          ? anchorPillHtml(d.anchor)
          : pendingDecisionAnchors.has(d.id)
            ? anchorPendingPillHtml()
            : anchorPillHtml(undefined);
      return `
        <article class="timeline-item">
          <div class="timeline-time">
            ${new Date(d.timestamp).toLocaleTimeString()}
            <div class="timeline-time-sub">decision ${escapeHtml(d.id.slice(0, 8))}…</div>
            <button type="button" class="btn-link" data-timeline-row="${realIndex}">View JSON</button>
          </div>
          <div class="timeline-content">
            <div class="timeline-headline">
              <span class="timeline-verdict ${klass}">${escapeHtml(verdictWord(d.verdict))}.</span>
              <span class="timeline-risk">risk · <strong>${d.riskScore}</strong> / 100</span>
            </div>
            ${rules ? `<div class="timeline-row-meta">${rules}</div>` : ""}
            ${playbookCell}
            <div class="timeline-row-anchor">${pillHtml}</div>
            <div class="timeline-row-reasons">${reasons}</div>
          </div>
        </article>`;
    })
    .join("");

  rows.querySelectorAll<HTMLButtonElement>("[data-timeline-row]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset["timelineRow"]);
      const d = window._timeline?.[i];
      if (d) showJsonModal(`Decision ${d.id}`, d);
    });
  });
}
