import {
  presetForbiddenApprove,
  presetOverCap,
  presetSafeTransfer,
  presetUnknownDest,
  submitEvaluateForm,
} from "../lib/evaluate.js";
import { closeJsonModal, copyJsonModal } from "../lib/modal.js";
import { loadDemo, loadPolicies, submitPolicyForm } from "../lib/policies.js";
import { loadTimeline } from "../lib/timeline.js";

function tickClock(): void {
  const el = document.getElementById("clock");
  if (!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  el.textContent = `${hh}:${mm}:${ss}`;
}

function bindForms(): void {
  const policyForm = document.getElementById("policy-form") as HTMLFormElement | null;
  policyForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    void submitPolicyForm(policyForm);
  });

  const evalForm = document.getElementById("evaluate-form") as HTMLFormElement | null;
  evalForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    void submitEvaluateForm(evalForm);
  });
}

/**
 * Disable a button + swap its label for a spinner while an async handler
 * runs, then restore both. Mirrors the pattern used inside the evaluate
 * form (lib/evaluate.ts) so the UX is consistent across the page.
 */
async function runWithBusyState(
  btn: HTMLButtonElement,
  busyLabel: string,
  handler: () => void | Promise<void>,
): Promise<void> {
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add("is-busy");
  btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${busyLabel}</span>`;
  try {
    await handler();
  } finally {
    btn.classList.remove("is-busy");
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

interface ActionConfig {
  handler: () => void | Promise<void>;
  /** Async actions render a busy state. Sync ones fire and forget. */
  busy?: boolean;
  /** Label to show inside the button while it's running. */
  busyLabel?: string;
}

function bindActionButtons(): void {
  const map: Record<string, ActionConfig> = {
    // Async actions hit the API and should show a busy state. The Quick
    // Demo path posts a policy that the server then anchors on 0G storage,
    // which can take 5-30s on Galileo — the loader keeps the UI honest.
    "load-demo": { handler: loadDemo, busy: true, busyLabel: "Loading demo" },
    "refresh-policies": { handler: loadPolicies, busy: true, busyLabel: "Refreshing" },
    "refresh-timeline": { handler: loadTimeline, busy: true, busyLabel: "Refreshing" },
    // Synchronous form-fill helpers. No await, no busy state.
    "preset-safe-transfer": { handler: presetSafeTransfer },
    "preset-over-cap": { handler: presetOverCap },
    "preset-forbidden-approve": { handler: presetForbiddenApprove },
    "preset-unknown-destination": { handler: presetUnknownDest },
    "modal-copy": { handler: copyJsonModal },
    "modal-close": { handler: () => closeJsonModal() },
  };
  for (const [action, cfg] of Object.entries(map)) {
    document
      .querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`)
      .forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          if (cfg.busy) {
            void runWithBusyState(el, cfg.busyLabel ?? "Working", cfg.handler);
          } else {
            void cfg.handler();
          }
        });
      });
  }
  document.getElementById("json-modal")?.addEventListener("click", (e) => {
    closeJsonModal(e);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeJsonModal();
  });
}

function init(): void {
  tickClock();
  setInterval(tickClock, 1000);
  bindForms();
  bindActionButtons();
  void loadPolicies();
  void loadTimeline();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
