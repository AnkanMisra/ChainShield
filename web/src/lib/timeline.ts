import { api } from "./api.js";
import { escapeHtml, renderReason, verdictKlass, verdictWord } from "./format.js";
import { showJsonModal } from "./modal.js";
import type { Decision } from "./types.js";

declare global {
  interface Window {
    _timeline?: Decision[];
  }
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
