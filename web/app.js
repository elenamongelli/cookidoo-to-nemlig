const element = (id) => document.getElementById(id);
const editor = element("shopping-list");
const reviewButton = element("review");
const results = element("results");
const search = element("search");
const dialog = element("import-dialog");
const tabs = [...document.querySelectorAll("[data-tab]")];
let reviewedText = null;
let review = null;
let activeTab = "products";
let pending = false;

const format = (amount) =>
  Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(2)));
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function showError(message) {
  element("error").textContent = message;
  element("error").hidden = !message;
}

function currentReview() {
  return review && editor.value === reviewedText && !pending;
}

function updateEditor() {
  const lines = editor.value
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
  element("line-count").textContent = plural(lines, "non-empty line");
  reviewButton.disabled = pending || !editor.value.trim();
  element("empty").disabled = pending || editor.disabled || !editor.value;
  if (!editor.value.trim() && !pending) {
    review = null;
    reviewedText = null;
    for (const name of ["lines", "products", "missing"])
      element(`stat-${name}`).textContent = "0";
    for (const name of ["products", "missing"])
      element(`count-${name}`).textContent = "0";
    search.value = "";
    search.disabled = true;
    element("review-notice").hidden = true;
    element("review-notice").textContent = "";
    element("result-count").textContent = "";
    element("import-summary").textContent = "No reviewed products yet";
    results.replaceChildren(
      emptyState("Your list is empty", "No ingredients to review."),
    );
  }
  const ready = currentReview() && Boolean(review.importUrl);
  element("copy").disabled = !ready;
  element("open").disabled = !ready;
  element("copy").textContent = "Copy link";
  element("save-status").textContent =
    review?.savedList && editor.value === reviewedText
      ? `Saved: ${review.savedList}`
      : "Not saved yet";
  element("input-status").textContent = pending
    ? "Saving and reviewing ingredients..."
    : !editor.value.trim()
      ? "Your list is empty. Previous versions are kept."
      : currentReview()
        ? "List saved. Review is up to date."
        : "List changed. Review again before opening Nemlig.";
  if (!currentReview()) {
    dialog.close();
    element("confirm-open").removeAttribute("href");
  }
}

function productRow(item) {
  const row = node("details", "product-row");
  const summary = node("summary");
  const name = node("div");
  name.append(node("span", "product-name", item.name));
  const meta = node("span", "product-meta");
  meta.append(
    node(
      "span",
      "source-toggle",
      plural(item.requirements.length, "source line"),
    ),
  );
  if (item.purchaseOverride) meta.append(node("span", "tag", "Approved"));
  if (item.estimated) meta.append(node("span", "tag estimated", "Estimated"));
  name.append(meta);
  const packCount = node("span", "pack-count", String(item.packages));
  packCount.setAttribute(
    "aria-label",
    `${plural(item.packages, "unit")} to buy`,
  );
  summary.append(
    name,
    node("span", "pack-size", `${format(item.pack.amount)} ${item.pack.unit}`),
    packCount,
  );
  const detail = node("div", "product-detail");
  const supplied = `${format(item.packages * item.pack.amount)} ${item.pack.unit}`;
  detail.append(
    node(
      "p",
      "detail-total",
      item.purchaseOverride
        ? `Supplies ${supplied} · Approved quantity · SKU ${item.sku}`
        : `Required ${format(item.required.amount)} ${item.required.unit} · Supplies ${supplied} · SKU ${item.sku}`,
    ),
  );
  for (const requirement of item.requirements) {
    const source = node("div", "source-line");
    source.append(
      node("span", "", `Line ${requirement.line}`),
      node("span", "", requirement.original),
    );
    detail.append(source);
  }
  for (const substitution of item.substitutions)
    detail.append(node("p", "substitution", substitution));
  row.append(summary, detail);
  return row;
}

function issueRow(requirement) {
  const row = node("article", "issue-row");
  const content = node("div");
  content.append(
    node("h3", "", requirement.original),
    node("p", "", requirement.reason),
  );
  row.append(node("span", "issue-line", `Line ${requirement.line}`), content);
  return row;
}

function emptyState(title, description) {
  const empty = node("div", "empty-state");
  empty.append(
    node("span", "empty-symbol", "\u2014"),
    node("h3", "", title),
    node("p", "", description),
  );
  empty.firstChild.setAttribute("aria-hidden", "true");
  return empty;
}

function renderResults() {
  if (!review) return;
  const all = activeTab === "products" ? review.items : review.unresolved;
  const query = search.value.trim().toLocaleLowerCase();
  const filtered = all.filter((item) => {
    const text =
      activeTab === "products"
        ? [
            item.name,
            item.sku,
            ...item.requirements.map(
              (source) => `${source.line} ${source.original}`,
            ),
            ...item.substitutions,
          ].join(" ")
        : `${item.line} ${item.original} ${item.reason}`;
    return text.toLocaleLowerCase().includes(query);
  });
  results.replaceChildren();
  results.setAttribute("aria-labelledby", `tab-${activeTab}`);
  if (activeTab === "missing" && all.length)
    results.append(
      node(
        "p",
        "section-note",
        "These ingredients are not in the Nemlig link. No suitable saved match or conversion was found.",
      ),
    );
  if (filtered.length && activeTab === "products") {
    const head = node("div", "product-head");
    head.setAttribute("aria-hidden", "true");
    head.append(
      node("span", "", "Product / sources"),
      node("span", "", "Pack size"),
      node("span", "", "Buy"),
    );
    results.append(head);
  }
  for (const item of filtered)
    results.append(
      activeTab === "products" ? productRow(item) : issueRow(item),
    );
  if (!filtered.length) {
    const messages = {
      products: [
        "No resolved products",
        "Unmatched ingredients remain in Missing.",
      ],
      missing: ["Nothing missing", "No unresolved ingredients in this review."],
    };
    results.append(
      emptyState(
        ...(query
          ? [
              "No matching results",
              "Try another product, ingredient, SKU or line number.",
            ]
          : messages[activeTab]),
      ),
    );
  }
  element("result-count").textContent =
    `${filtered.length} of ${all.length} ${activeTab === "products" ? "products" : "ingredients"}`;
}

function renderReview() {
  const packages = review.items.reduce(
    (total, item) => total + item.packages,
    0,
  );
  const counts = {
    lines: review.requirementCount,
    products: review.items.length,
    missing: review.unresolved.length,
  };
  for (const [key, value] of Object.entries(counts))
    element(`stat-${key}`).textContent = String(value);
  element("count-products").textContent = String(review.items.length);
  element("count-missing").textContent = String(review.unresolved.length);
  const planNotice =
    review.planNotice ===
    "Approved plan not applied: shopping-list text differs from the reviewed list."
      ? ""
      : review.planNotice;
  element("review-notice").textContent = planNotice ?? "";
  element("review-notice").hidden = !planNotice;
  element("import-summary").textContent =
    `${plural(review.items.length, "product")} · ${plural(packages, "unit")} to buy`;
  search.disabled = false;
  renderResults();
}

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "The request could not be completed.");
  return data;
}

const shortDate = (value) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function householdRow(item) {
  const row = node(
    "article",
    item.attention ? "household-row attention" : "household-row",
  );
  const heading = node("div", "household-heading");
  heading.append(
    node("h3", "", item.name.charAt(0).toUpperCase() + item.name.slice(1)),
    node("span", item.attention ? "tag estimated" : "tag", item.label),
  );
  row.append(heading);
  if (item.question) row.append(node("p", "household-question", item.question));
  const facts = [
    item.lastPurchasedOn
      ? `Last bought ${shortDate(item.lastPurchasedOn)}`
      : "No receipt found",
    ...(item.dueOn ? [`Recheck ${shortDate(item.dueOn)}`] : []),
    ...(item.checkOffers ? ["Offers worth checking"] : []),
  ];
  row.append(node("p", "household-facts", facts.join(" \u00b7 ")));
  return row;
}

async function loadHousehold() {
  const list = element("household-list");
  try {
    const data = await requestJson("/api/household");
    element("household-date").textContent = shortDate(data.on).toUpperCase();
    const items = [...data.items].sort(
      (left, right) => Number(right.attention) - Number(left.attention),
    );
    list.replaceChildren(...items.map(householdRow));
    if (!items.length)
      list.append(
        emptyState("No tracked supplies", "Nothing is configured yet."),
      );
    if (data.warnings)
      list.append(
        node(
          "p",
          "section-note",
          `${plural(data.warnings, "receipt warning")}. Ask the assistant to run the household check.`,
        ),
      );
  } catch {
    element("household-date").textContent = "UNAVAILABLE";
    list.replaceChildren(
      emptyState(
        "Household supplies unavailable",
        "Reload the page to try again.",
      ),
    );
  }
}

async function runReview() {
  if (pending || !editor.value.trim()) return;
  const text = editor.value;
  pending = true;
  showError("");
  element("review-panel").setAttribute("aria-busy", "true");
  reviewButton.textContent = "Reviewing...";
  updateEditor();
  try {
    review = await requestJson("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    reviewedText = text;
    renderReview();
  } catch (error) {
    reviewedText = null;
    showError(error.message);
    if (!review)
      results.replaceChildren(
        emptyState(
          "Review unavailable",
          "Check the connection, then select Review list to retry.",
        ),
      );
  } finally {
    pending = false;
    reviewButton.textContent = "Review list \u2192";
    element("review-panel").setAttribute("aria-busy", "false");
    updateEditor();
  }
}

function selectTab(tab) {
  activeTab = tab.dataset.tab;
  for (const candidate of tabs) {
    candidate.setAttribute("aria-selected", String(candidate === tab));
    candidate.tabIndex = candidate === tab ? 0 : -1;
  }
  renderResults();
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    let target;
    if (event.key === "ArrowRight") target = tabs[(index + 1) % tabs.length];
    if (event.key === "ArrowLeft")
      target = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === "Home") target = tabs[0];
    if (event.key === "End") target = tabs[tabs.length - 1];
    if (target) {
      event.preventDefault();
      selectTab(target);
      target.focus();
    }
  });
}
editor.addEventListener("input", updateEditor);
search.addEventListener("input", renderResults);
reviewButton.addEventListener("click", runReview);
element("empty").addEventListener("click", () => {
  if (pending || editor.disabled) return;
  editor.value = "";
  showError("");
  updateEditor();
  editor.focus();
});
element("copy").addEventListener("click", async () => {
  if (!currentReview() || !review.importUrl) return;
  try {
    await navigator.clipboard.writeText(review.importUrl);
    element("copy").textContent = "Copied";
    element("input-status").textContent =
      "Nemlig link copied. Opening it can change your basket.";
  } catch {
    showError(
      "Clipboard unavailable. Use Open Nemlig to access the reviewed link; copying requires HTTPS or localhost.",
    );
  }
});
element("open").addEventListener("click", () => {
  if (!currentReview() || !review.importUrl) return;
  element("confirm-open").href = review.importUrl;
  element("dialog-summary").textContent =
    `${plural(review.items.length, "product")} included. ${plural(review.unresolved.length, "missing ingredient")} not in the link.`;
  dialog.showModal();
  element("cancel-open").focus();
});
element("cancel-open").addEventListener("click", () => dialog.close());
element("confirm-open").addEventListener("click", (event) => {
  if (!currentReview() || !review.importUrl) event.preventDefault();
  dialog.close();
});

updateEditor();
loadHousehold();
