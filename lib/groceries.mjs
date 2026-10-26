import { createImportUrl } from "./basket-link.mjs";
import { PreferredProducts } from "./preferred-products.mjs";
import { findStandingExclusion } from "./standing-exclusions.mjs";
import { normalize } from "./text-utils.mjs";
import { CATEGORIES, FORMS, HERBS, UNITS } from "./vocabulary.mjs";

export { normalize };

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const QUANTITY = new RegExp(
  `^(${NUMBER})(?:\\s*[-\\u2013\\u2014]\\s*(${NUMBER}))?\\s*(.*)$`,
);
function defaultUnit(ingredient) {
  const herb = normalize(ingredient)
    .split(" ")
    .filter((word) => !FORMS.has(word))
    .join(" ");
  return HERBS.has(herb) ? "leaf" : "count";
}

function parseRequirement(original, line) {
  const requirement = { line, original };
  const match = original.match(QUANTITY);
  if (!match || !match[3].trim()) {
    return {
      ...requirement,
      status: "unresolved",
      reason: "Missing quantity or ingredient.",
    };
  }

  const lower = Number(match[1].replace(",", "."));
  const upper =
    match[2] === undefined ? lower : Number(match[2].replace(",", "."));
  if (!(lower > 0) || upper < lower || !Number.isFinite(upper)) {
    return {
      ...requirement,
      status: "unresolved",
      reason: "Invalid quantity or range.",
    };
  }

  let ingredient = match[3].trim();
  const firstWord = ingredient.match(/^([^\s]+)(?:\s+|$)/)[1];
  const conversion = UNITS.get(firstWord.toLowerCase());
  if (conversion) ingredient = ingredient.slice(firstWord.length).trim();
  ingredient = ingredient.replace(/^(?:di|de|del|della)\s+/i, "");
  if (!ingredient) {
    return {
      ...requirement,
      status: "unresolved",
      reason: "Missing ingredient.",
    };
  }

  return {
    ...requirement,
    ingredient,
    amount: upper * (conversion?.multiplier ?? 1),
    unit: conversion?.unit ?? defaultUnit(ingredient),
    range: match[2] ? { lower, upper } : null,
  };
}

export function parseList(text) {
  const requirements = [];
  for (const [index, source] of text.split(/\r?\n/).entries()) {
    const original = source.trim();
    if (!original) continue;
    if (!CATEGORIES.has(original))
      requirements.push(parseRequirement(original, index + 1));
  }
  return requirements;
}

export function buildReview(text, products) {
  const requirements = parseList(text);
  const preferred = new PreferredProducts(products);
  const groups = new Map();
  const unresolved = [];
  const excluded = [];
  for (const requirement of requirements) {
    const exclusion = findStandingExclusion(
      requirement.ingredient ?? requirement.original,
    );
    if (exclusion) {
      excluded.push({
        ...requirement,
        status: "excluded",
        reason: exclusion.reason,
      });
      continue;
    }
    if (requirement.status === "unresolved") {
      unresolved.push(requirement);
      continue;
    }
    const match = preferred.resolve(requirement);
    if (match.reason) {
      unresolved.push({ ...requirement, status: "unresolved", ...match });
      continue;
    }
    const { pack, converted } = match;
    if (!groups.has(match.sku))
      groups.set(match.sku, {
        sku: match.sku,
        name: match.product.name,
        provenance: "preferred",
        pack,
        required: { amount: 0, unit: pack.unit },
        estimated: false,
        requirements: [],
        substitutions: [],
      });
    const group = groups.get(match.sku);
    group.required.amount += converted.amount;
    group.estimated ||= converted.estimated;
    group.requirements.push(requirement);
    group.substitutions.push(...match.substitutions);
  }
  const items = [...groups.values()].map((group) => ({
    ...group,
    packages: Math.ceil(group.required.amount / group.pack.amount),
    substitutions: [...new Set(group.substitutions)],
    status: "provisional",
    priceAndAvailability: "not-checked",
  }));
  return {
    mode: "offline-dry-run",
    basketChanged: false,
    importReady: false,
    requirementCount: requirements.length,
    items,
    unresolved,
    excluded,
    importUrl: createImportUrl(items),
  };
}
