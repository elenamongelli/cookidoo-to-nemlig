import { createHash } from "node:crypto";
import { createImportUrl } from "./basket-link.mjs";
import { buildReview, parseList } from "./groceries.mjs";
import { PreferredProducts } from "./preferred-products.mjs";

function fingerprint(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n/g, "\n").trimEnd())
    .digest("hex");
}

function productFingerprint(products, decisions) {
  const snapshot = decisions.purchases.map(([sku]) => {
    const product = products[sku];
    if (!product) throw new Error(`Missing approved SKU: ${sku}`);
    return [sku, product.name, product.pack ?? null];
  });
  return fingerprint(JSON.stringify(snapshot));
}

export function approvedPlanMismatch(text, products, decisions) {
  if (fingerprint(text) !== decisions.sourceSha256)
    return "Approved plan not applied: shopping-list text differs from the reviewed list.";
  if (productFingerprint(products, decisions) !== decisions.productsSha256)
    return "Approved plan not applied: a selected product name or pack size changed.";
  return null;
}

export function buildApprovedReview(text, products, decisions) {
  if (approvedPlanMismatch(text, products, decisions)) return null;

  const requirements = parseList(text);
  const requirementByLine = new Map(
    requirements.map((requirement) => [requirement.line, requirement]),
  );
  const accountedLines = new Set();
  const selectedSkus = new Set();
  const preferred = new PreferredProducts(products);

  function takeRequirements(lines) {
    return lines.map((line) => {
      const requirement = requirementByLine.get(line);
      if (!requirement || accountedLines.has(line))
        throw new Error(`Invalid or duplicate approved source line: ${line}`);
      accountedLines.add(line);
      return requirement;
    });
  }

  const items = decisions.purchases.map(([sku, packages, sourceLines]) => {
    const product = products[sku];
    if (!product || selectedSkus.has(sku))
      throw new Error(`Invalid or duplicate approved SKU: ${sku}`);
    if (!Number.isSafeInteger(packages) || packages <= 0)
      throw new Error(`Invalid approved package count for SKU ${sku}`);
    selectedSkus.add(sku);

    const pack = preferred.packSize(product);
    if (!pack) throw new Error(`Missing pack size for approved SKU ${sku}`);

    return {
      sku,
      name: product.name,
      provenance: "approved-current-list",
      pack,
      packages,
      purchaseOverride: true,
      estimated: decisions.estimatedSkus.includes(sku),
      requirements: takeRequirements(sourceLines),
      substitutions: decisions.substitutions[sku]
        ? [decisions.substitutions[sku]]
        : [],
      status: "provisional",
      priceAndAvailability: "not-checked",
    };
  });

  const excluded = decisions.excluded.map(([line, reason]) => ({
    ...takeRequirements([line])[0],
    status: "excluded",
    reason,
  }));

  if (accountedLines.size !== requirements.length)
    throw new Error(
      "Approved list decisions do not account for every source line.",
    );

  return {
    mode: "offline-dry-run",
    basketChanged: false,
    importReady: false,
    requirementCount: requirements.length,
    items,
    unresolved: [],
    excluded,
    importUrl: createImportUrl(items),
  };
}

export function buildReviewForInput(text, products, decisions) {
  const planNotice = approvedPlanMismatch(text, products, decisions);
  if (planNotice) return { ...buildReview(text, products), planNotice };
  return buildApprovedReview(text, products, decisions);
}
