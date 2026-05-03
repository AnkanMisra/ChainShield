import { api } from "./api.js";
import {
  escapeHtml,
  gaugeSvg,
  renderReason,
  summarizeZodIssues,
  verdictKlass,
  verdictWord,
} from "./format.js";
import { showJsonModal } from "./modal.js";
import { loadTimeline, markDecisionPending } from "./timeline.js";
import { ATTACKER, COLD_VAULT, TOKEN, TREASURY } from "./policies.js";
import type { Decision } from "./types.js";

declare global {
  interface Window {
    _lastDecision?: Decision | null;
    _lastErrorData?: unknown;
  }
}

type FieldEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function getField(form: HTMLFormElement, name: string): string {
  const el = form.querySelector<FieldEl>(`[name="${name}"]`);
  return (el?.value ?? "").trim();
}

export async function submitEvaluateForm(form: HTMLFormElement): Promise<void> {
  const body = {
    policyId: getField(form, "policyId"),
    intent: {
      from: getField(form, "from"),
      to: getField(form, "to"),
      value: getField(form, "value") || "0",
      data: getField(form, "data") || "0x",
      chainId: Number(getField(form, "chainId") || "16602"),
    },
  };
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const originalLabel = submitBtn?.innerHTML ?? "Evaluate";
  setSubmitBusy(submitBtn, true);
  const stopLoader = renderEvaluateLoading();
  try {
    const r = await api<Decision>("POST", "/evaluate", body);
    stopLoader();
    renderEvaluate(r);
    if (r.ok && r.data && typeof r.data === "object" && "id" in r.data) {
      const created = r.data as Decision;
      if (created.id && (!created.anchor || !created.anchor.rootHash)) {
        markDecisionPending(created.id);
      }
    }
    await loadTimeline();
  } finally {
    setSubmitBusy(submitBtn, false, originalLabel);
  }
}

function setSubmitBusy(
  btn: HTMLButtonElement | null,
  busy: boolean,
  restoreLabel?: string,
): void {
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle("is-busy", busy);
  if (busy) {
    btn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span><span>Evaluating</span>';
  } else if (restoreLabel !== undefined) {
    btn.innerHTML = restoreLabel;
  }
}

/**
 * Render an interim "working" panel while the /evaluate request is in flight.
 * The slowest server stage is the 0G storage upload (5-30s on Galileo testnet).
 * A live elapsed timer plus an explicit phase list keeps the user oriented
 * instead of staring at a frozen UI.
 *
 * Returns a function that stops the timer and clears the interval.
 */
function renderEvaluateLoading(): () => void {
  const el = document.getElementById("evaluate-result");
  if (!el) return () => {};
  const start = performance.now();
  el.innerHTML =
    '<span class="verdict-corner">Working</span>' +
    '<div class="verdict-loading">' +
    '<div class="verdict-result-head">' +
    "<span>Evaluating intent</span>" +
    "</div>" +
    '<h3 class="verdict-stamp accent">Working.</h3>' +
    '<div class="verdict-loading-bar" aria-hidden="true"><span></span></div>' +
    '<div class="verdict-loading-row">' +
    '<div class="verdict-loading-elapsed" data-loading-elapsed>0.0s</div>' +
    '<div class="verdict-loading-label">Elapsed</div>' +
    "</div>" +
    '<ul class="reasons verdict-loading-reasons">' +
    "<li>Validating intent against the policy schema.</li>" +
    "<li>Running the deterministic rule ladder.</li>" +
    "<li>Simulating ERC-20 effects via the heuristic decoder.</li>" +
    "<li><strong>Anchoring the decision on 0G Storage</strong> &mdash; Galileo testnet uploads typically 5&ndash;30s.</li>" +
    "</ul>" +
    "</div>";
  const elapsedEl = el.querySelector<HTMLElement>("[data-loading-elapsed]");
  const timer = window.setInterval(() => {
    if (!elapsedEl) return;
    const sec = (performance.now() - start) / 1000;
    elapsedEl.textContent = `${sec.toFixed(1)}s`;
  }, 100);
  return () => window.clearInterval(timer);
}

function renderEvaluate(r: { ok: boolean; status: number; data: unknown }): void {
  const el = document.getElementById("evaluate-result");
  if (!el) return;
  if (!r.ok) {
    window._lastDecision = null;
    window._lastErrorData = r.data;
    el.innerHTML =
      '<span class="verdict-corner">Error</span>' +
      '<div class="verdict-result">' +
      '<div class="verdict-result-head"><span>Request failed</span>' +
      '<button type="button" class="btn-link" data-action="show-error-json">View JSON</button>' +
      "</div>" +
      '<h3 class="verdict-stamp block">Error</h3>' +
      '<div class="verdict-error">' +
      escapeHtml(JSON.stringify(r.data, null, 2)) +
      "</div>" +
      "</div>";
    el.querySelector('[data-action="show-error-json"]')?.addEventListener("click", () => {
      showJsonModal("Request error", window._lastErrorData, {
        summaryHtml: summarizeZodIssues(window._lastErrorData),
      });
    });
    return;
  }
  const d = r.data as Decision;
  window._lastDecision = d;
  const klass = verdictKlass(d.verdict);
  const reasons = (d.reasons ?? [])
    .map((x) => `<li>${renderReason(x)}</li>`)
    .join("");
  const rules = (d.rulesMatched ?? [])
    .map((x) => `<span class="badge">${escapeHtml(x)}</span>`)
    .join("");
  const playbookBadge = d.playbookTriggered
    ? `<div class="playbook-badge">playbook fired · ${escapeHtml(d.playbookTriggered.id)} / run ${escapeHtml(d.playbookTriggered.runId)}</div>`
    : "";
  const idShort = d.id ? d.id.slice(0, 8) : "";

  el.innerHTML =
    '<span class="verdict-corner">Verdict</span>' +
    '<div class="verdict-result">' +
    '<div class="verdict-result-head">' +
    `<span>Decision · ${escapeHtml(idShort)}…</span>` +
    '<button type="button" class="btn-link" data-action="show-decision-json">View JSON</button>' +
    "</div>" +
    `<h3 class="verdict-stamp ${klass}">${escapeHtml(verdictWord(d.verdict))}.</h3>` +
    '<div class="verdict-meta">' +
    `<div class="verdict-meta-item">verdict · <strong>${escapeHtml(d.verdict)}</strong></div>` +
    `<div class="verdict-meta-item">timestamp · <strong>${new Date(d.timestamp).toLocaleTimeString()}</strong></div>` +
    "</div>" +
    '<div class="verdict-gauge-wrap">' +
    `<div class="verdict-gauge ${klass}">${gaugeSvg(d.riskScore)}</div>` +
    '<div class="verdict-gauge-readout">' +
    `<div class="verdict-gauge-value">${escapeHtml(String(d.riskScore))}<span class="max"> / 100</span></div>` +
    '<div class="verdict-gauge-label">Risk score</div>' +
    "</div>" +
    "</div>" +
    (rules ? `<div class="badge-row">${rules}</div>` : "") +
    playbookBadge +
    `<ul class="reasons">${reasons}</ul>` +
    "</div>";
  el.querySelector('[data-action="show-decision-json"]')?.addEventListener("click", () => {
    if (window._lastDecision) {
      showJsonModal(`Decision ${window._lastDecision.id}`, window._lastDecision);
    }
  });
}

function setEvaluateForm(updates: Record<string, string>): void {
  const f = document.getElementById("evaluate-form") as HTMLFormElement | null;
  if (!f) return;
  for (const [name, value] of Object.entries(updates)) {
    const el = f.querySelector<FieldEl>(`[name="${name}"]`);
    if (el) el.value = value;
  }
}

export function presetSafeTransfer(): void {
  setEvaluateForm({
    from: TREASURY,
    to: COLD_VAULT,
    value: "500000000000000000",
    data: "0x",
  });
}

export function presetOverCap(): void {
  setEvaluateForm({
    from: TREASURY,
    to: COLD_VAULT,
    value: "5000000000000000000",
    data: "0x",
  });
}

export function presetForbiddenApprove(): void {
  const spender = ATTACKER.slice(2).toLowerCase().padStart(64, "0");
  const amount = "f".repeat(64);
  setEvaluateForm({
    from: TREASURY,
    to: TOKEN,
    value: "0",
    data: `0x095ea7b3${spender}${amount}`,
  });
}

export function presetUnknownDest(): void {
  setEvaluateForm({
    from: TREASURY,
    to: ATTACKER,
    value: "100000000000000000",
    data: "0x",
  });
}
