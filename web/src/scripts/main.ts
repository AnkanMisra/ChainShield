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

function bindActionButtons(): void {
  const map: Record<string, () => void | Promise<void>> = {
    "load-demo": loadDemo,
    "refresh-policies": loadPolicies,
    "refresh-timeline": loadTimeline,
    "preset-safe-transfer": presetSafeTransfer,
    "preset-over-cap": presetOverCap,
    "preset-forbidden-approve": presetForbiddenApprove,
    "preset-unknown-destination": presetUnknownDest,
    "modal-copy": copyJsonModal,
    "modal-close": () => closeJsonModal(),
  };
  for (const [action, handler] of Object.entries(map)) {
    document
      .querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`)
      .forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          void handler();
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
