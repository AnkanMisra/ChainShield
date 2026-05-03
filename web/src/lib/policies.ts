import { api } from "./api.js";
import { anchorPendingPillHtml, anchorPillHtml, escapeHtml, formatRules } from "./format.js";
import { showJsonModal } from "./modal.js";
import { summarizeZodIssues } from "./format.js";
import type { Address, Hex, Policy } from "./types.js";

/**
 * Policy ids whose 0G anchor upload is still in flight on the server.
 * Set + cleared by `pollForAnchor`. Used by `loadPolicies` to render the
 * pulsing "anchoring" pill instead of the terminal "not anchored" pill
 * for rows that are still being committed.
 */
const pendingAnchors = new Set<string>();

const ANCHOR_POLL_INTERVAL_MS = 2_000;
const ANCHOR_POLL_TIMEOUT_MS = 30_000;

export const TREASURY: Address = "0x1111111111111111111111111111111111111111";
export const COLD_VAULT: Address = "0x2222222222222222222222222222222222222222";
export const ATTACKER: Address = "0x3333333333333333333333333333333333333333";
export const TOKEN: Address = "0x4444444444444444444444444444444444444444";

type FieldEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function findField(form: HTMLFormElement, name: string): FieldEl | null {
  return form.querySelector<FieldEl>(`[name="${name}"]`);
}

function formGet(form: HTMLFormElement, name: string): string | undefined {
  const el = findField(form, name);
  if (!el) return undefined;
  const v = el.value.trim();
  return v ? v : undefined;
}

function formCsv(form: HTMLFormElement, name: string): string[] | undefined {
  const raw = formGet(form, name);
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

interface PolicyRulesInput {
  maxTransferEth?: number;
  maxDailyOutflowEth?: number;
  allowedDestinations?: Address[];
  forbiddenSelectors?: Hex[];
}

interface PolicyInputBody {
  owner: string | undefined;
  rules: PolicyRulesInput;
  remediation: { onBlock?: string[] };
}

export async function submitPolicyForm(form: HTMLFormElement): Promise<void> {
  const rules: PolicyRulesInput = {};
  const mt = formGet(form, "maxTransferEth");
  if (mt) rules.maxTransferEth = Number(mt);
  const md = formGet(form, "maxDailyOutflowEth");
  if (md) rules.maxDailyOutflowEth = Number(md);
  const ad = formCsv(form, "allowedDestinations");
  if (ad) rules.allowedDestinations = ad as Address[];
  const fs = formCsv(form, "forbiddenSelectors");
  if (fs) rules.forbiddenSelectors = fs as Hex[];

  const remediation: { onBlock?: string[] } = {};
  const ob = formCsv(form, "onBlock");
  if (ob) remediation.onBlock = ob;

  const body: PolicyInputBody = {
    owner: formGet(form, "owner"),
    rules,
    remediation,
  };

  const r = await api<unknown>("POST", "/policies", body);
  if (!r.ok) {
    showJsonModal("Failed to create policy", r.data, {
      summaryHtml: summarizeZodIssues(r.data),
    });
    return;
  }
  form.reset();
  await loadPolicies();
}

export async function loadPolicies(): Promise<void> {
  const r = await api<Policy[]>("GET", "/policies");
  const list = document.getElementById("policies-list");
  const select = document.getElementById("policy-select") as HTMLSelectElement | null;
  const count = document.getElementById("policies-count");
  if (!list || !select) return;
  if (!r.ok || !Array.isArray(r.data)) {
    list.innerHTML = '<div class="empty">Failed to load.</div>';
    return;
  }
  if (count) count.textContent = String(r.data.length).padStart(2, "0");
  if (r.data.length === 0) {
    list.innerHTML =
      '<div class="empty">No policies yet. Fill the form, or click <em>Quick demo</em>.</div>';
    select.innerHTML = '<option value="">— no policies —</option>';
    return;
  }
  list.innerHTML = r.data
    .map((p) => renderPolicyCard(p))
    .join("");
  select.innerHTML =
    '<option value="">— select a policy —</option>' +
    r.data
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}">${escapeHtml(p.owner)} (v${p.version}) — ${escapeHtml(p.id.slice(0, 8))}…</option>`,
      )
      .join("");
}

/**
 * Render the active-policies list. Cards whose anchor is still uploading on
 * the server (tracked in `pendingAnchors`) get the pulsing "anchoring" pill
 * instead of the terminal "not anchored" pill. The set is updated by
 * `pollForAnchor` and re-renders are triggered by `loadPolicies`.
 */
function renderPolicyCard(p: Policy): string {
  const pillHtml =
    p.anchor && p.anchor.rootHash
      ? anchorPillHtml(p.anchor)
      : pendingAnchors.has(p.id)
        ? anchorPendingPillHtml()
        : anchorPillHtml(undefined);
  return `
    <div class="policy-card" data-policy-id="${escapeHtml(p.id)}">
      <div class="policy-card-row">
        <span class="policy-card-owner">${escapeHtml(p.owner)}</span>
        <span class="policy-card-version">v${p.version}</span>
      </div>
      <div class="policy-card-id">${escapeHtml(p.id)}</div>
      <div class="policy-card-rules">${escapeHtml(formatRules(p.rules))}</div>
      <div class="policy-card-anchor">${pillHtml}</div>
    </div>
  `;
}

/**
 * Skeleton card injected into the policies list the moment the user clicks
 * Quick Demo. It occupies the same vertical slot a real card would, with
 * a shimmer animation across each row, so the eye lands in the right
 * place. Replaced wholesale by `loadPolicies` once the POST returns
 * (~50ms with the new async-anchor server path).
 */
function policySkeletonHtml(): string {
  return `
    <div class="policy-card policy-card-skeleton" aria-busy="true">
      <div class="policy-card-row">
        <span class="skeleton skeleton-text skeleton-owner"></span>
        <span class="skeleton skeleton-text skeleton-version"></span>
      </div>
      <div class="skeleton skeleton-text skeleton-id"></div>
      <div class="skeleton skeleton-text skeleton-rules"></div>
      <div class="policy-card-anchor"><span class="skeleton skeleton-pill"></span></div>
    </div>
  `;
}

/**
 * Click Quick Demo:
 *   1. Render a skeleton card immediately so the user gets visual feedback.
 *   2. POST the policy in background. With the server's fire-and-forget
 *      anchoring, this returns in ~50ms instead of 5-30s.
 *   3. Replace the skeleton with the real card by reloading the list.
 *      The new card's anchor pill shows "anchoring" while polling runs.
 *   4. Poll GET /policies/:id every 2s for up to 30s. When the anchor
 *      lands on the server it shows up in the response; we update the set
 *      and re-render so the pill flips to the lime "0G | 0xroot…" link.
 */
export async function loadDemo(): Promise<void> {
  const list = document.getElementById("policies-list");
  if (list) list.innerHTML = policySkeletonHtml();

  // Pre-fill the evaluate form regardless of POST latency.
  const f = document.getElementById("evaluate-form") as HTMLFormElement | null;
  if (f) {
    const fromEl = findField(f, "from");
    const toEl = findField(f, "to");
    if (fromEl) fromEl.value = TREASURY;
    if (toEl) toEl.value = COLD_VAULT;
  }

  const r = await api<Policy>("POST", "/policies", {
    owner: TREASURY,
    rules: {
      maxTransferEth: 1,
      maxDailyOutflowEth: 3,
      allowedDestinations: [COLD_VAULT],
      forbiddenSelectors: ["0x095ea7b3"],
    },
    remediation: { onBlock: [], notifyChannels: ["collector"] },
  });

  if (r.ok && r.data && typeof r.data === "object" && "id" in r.data) {
    const created = r.data as Policy;
    if (!created.anchor || !created.anchor.rootHash) {
      pendingAnchors.add(created.id);
      void pollForAnchor(created.id);
    }
  }

  await loadPolicies();

  const select = document.getElementById("policy-select") as HTMLSelectElement | null;
  if (select && select.options.length > 1 && select.options[1]) {
    select.value = select.options[1].value;
  }
}

/**
 * Poll GET /policies/:id every {@link ANCHOR_POLL_INTERVAL_MS}ms. Stops when
 * the response includes a non-empty rootHash (anchor landed) or after
 * {@link ANCHOR_POLL_TIMEOUT_MS}ms (assume the upload failed silently — the
 * pill drops back to the terminal "not anchored" state).
 *
 * Intentionally tolerant: any non-2xx, network blip, or shape mismatch just
 * keeps the polling loop running until the timeout. The user sees a worst
 * case of a 30s pulsing pill that quietly resolves.
 */
async function pollForAnchor(policyId: string): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < ANCHOR_POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, ANCHOR_POLL_INTERVAL_MS));
    const r = await api<Policy>("GET", `/policies/${encodeURIComponent(policyId)}`);
    if (
      r.ok &&
      r.data &&
      typeof r.data === "object" &&
      "anchor" in r.data &&
      r.data.anchor &&
      typeof r.data.anchor === "object" &&
      "rootHash" in r.data.anchor &&
      typeof r.data.anchor.rootHash === "string" &&
      r.data.anchor.rootHash.length > 0
    ) {
      pendingAnchors.delete(policyId);
      await loadPolicies();
      return;
    }
  }
  // Timed out — drop the pending state and re-render so the pill flips to
  // the terminal "not anchored" marker.
  pendingAnchors.delete(policyId);
  await loadPolicies();
}
