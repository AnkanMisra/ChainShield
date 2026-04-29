let modalText = "";

interface ShowOpts {
  summaryHtml?: string;
}

export function showJsonModal(title: string, data: unknown, opts: ShowOpts = {}): void {
  modalText = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const titleEl = document.getElementById("json-modal-title");
  const bodyEl = document.getElementById("json-modal-body");
  const sumEl = document.getElementById("json-modal-summary");
  const copyBtn = document.getElementById("json-modal-copy");
  const modal = document.getElementById("json-modal");
  if (!titleEl || !bodyEl || !sumEl || !copyBtn || !modal) return;
  titleEl.textContent = title;
  bodyEl.textContent = modalText;
  sumEl.innerHTML = opts.summaryHtml ?? "";
  sumEl.style.display = opts.summaryHtml ? "" : "none";
  copyBtn.textContent = "Copy JSON";
  modal.classList.remove("hidden");
}

export function closeJsonModal(e?: Event): void {
  if (e && e.target instanceof HTMLElement && e.target.id !== "json-modal") return;
  document.getElementById("json-modal")?.classList.add("hidden");
}

export async function copyJsonModal(): Promise<void> {
  const btn = document.getElementById("json-modal-copy");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(modalText);
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => {
    if (btn) btn.textContent = "Copy JSON";
  }, 1500);
}
