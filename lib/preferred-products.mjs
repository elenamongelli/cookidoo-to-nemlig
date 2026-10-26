import { normalize } from "./text-utils.mjs";
import { DECORATIONS, FORMS, UNITS } from "./vocabulary.mjs";

function containsPhrase(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `);
}

export class PreferredProducts {
  constructor(products) {
    this.products = Object.entries(products).map(([sku, product]) => ({
      sku,
      product,
      aliases: Object.values(product.aliases ?? {})
        .flat()
        .map(normalize)
        .sort((left, right) => right.length - left.length),
    }));
    this.danishNameIndex = new Map();
    for (const candidate of this.products) {
      for (const alias of candidate.product.aliases?.da ?? []) {
        const normalizedAlias = normalize(alias);
        const candidates = this.danishNameIndex.get(normalizedAlias) ?? [];
        candidates.push({ ...candidate, alias: normalizedAlias });
        this.danishNameIndex.set(normalizedAlias, candidates);
      }
    }
  }

  resolve(requirement) {
    const match = this.match(requirement);
    if (match.reason) return match;

    const pack = this.packSize(match.product);
    const converted = pack
      ? this.convert(requirement, match.product, pack)
      : { reason: "Product pack size is unknown; clarification required." };

    if (converted.reason) {
      return { candidateSkus: [match.sku], reason: converted.reason };
    }

    return { ...match, pack, converted };
  }

  packSize(product) {
    if (product.pack) {
      const { amount, unit } = product.pack;
      return Number.isFinite(amount) &&
        amount > 0 &&
        ["g", "ml", "count"].includes(unit)
        ? { amount, unit }
        : null;
    }
    const match = product.name.match(
      /(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|stk\.?|rl\.?)\s*$/i,
    );
    if (!match) return null;
    const packUnit = match[3].toLowerCase().replace(".", "");
    const { unit, multiplier } = ["stk", "rl"].includes(packUnit)
      ? { unit: "count", multiplier: 1 }
      : UNITS.get(packUnit);
    const amount =
      Number(match[2].replace(",", ".")) * Number(match[1] ?? 1) * multiplier;
    return amount > 0 && Number.isFinite(amount) ? { amount, unit } : null;
  }

  match(requirement) {
    const ingredient = normalize(requirement.ingredient);
    const exactDanishMatches = this.danishNameIndex.get(ingredient);
    if (exactDanishMatches) {
      const uniqueMatches = [
        ...new Map(
          exactDanishMatches.map((candidate) => [candidate.sku, candidate]),
        ).values(),
      ];
      return this.validate(uniqueMatches[0], ingredient);
    }

    const matches = [];
    for (const { sku, product, aliases } of this.products) {
      const alias = aliases.find((alias) => containsPhrase(ingredient, alias));
      if (alias) matches.push({ sku, product, alias });
    }
    if (!matches.length)
      return { reason: "No preferred product alias matches." };
    const longest = Math.max(...matches.map((match) => match.alias.length));
    const candidates = matches.filter(
      (match) => match.alias.length === longest,
    );
    return this.validate(candidates[0], ingredient);
  }

  validate(candidate, ingredient) {
    const rules = candidate.product.rules ?? {};
    const requestedForms = [
      ...new Set(
        ingredient
          .split(" ")
          .map((word) => FORMS.get(word))
          .filter(Boolean),
      ),
    ];
    const substitutions = [];
    for (const form of requestedForms) {
      if (form === rules.form) continue;
      if (
        requestedForms.length === 1 &&
        form === "fresh" &&
        rules.form === "frozen" &&
        rules.allowFresh
      ) {
        substitutions.push("Standing preference: fresh to frozen.");
      } else if (
        requestedForms.length === 1 &&
        form === "dried" &&
        rules.form === "fresh" &&
        rules.allowDried
      ) {
        substitutions.push(
          "Approved substitution: dried mushrooms to fresh champignons.",
        );
      } else
        return {
          reason: `Requested form '${form}' is not approved for this product.`,
          candidateSkus: [candidate.sku],
        };
    }
    const remainder = ` ${ingredient} `
      .replace(` ${candidate.alias} `, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const unrecognized = remainder.filter(
      (word) => !DECORATIONS.has(word) && !FORMS.has(word),
    );
    if (unrecognized.length)
      return {
        reason: `Unconfirmed ingredient qualifier: ${unrecognized.join(" ")}.`,
        candidateSkus: [candidate.sku],
      };
    if (
      (rules.substitutionAliases ?? []).some((alias) =>
        containsPhrase(ingredient, normalize(alias)),
      )
    ) {
      substitutions.push("Standing purchasing group: use preferred onions.");
    }
    return { ...candidate, substitutions };
  }

  convert(requirement, product, pack) {
    const rules = product.rules ?? {};
    let { amount, unit } = requirement;
    if (unit === "count" && rules.defaultUnit) {
      unit = rules.defaultUnit;
      amount *= rules.defaultMultiplier ?? 1;
    }
    if (unit === "pack")
      return {
        amount: amount * pack.amount,
        unit: pack.unit,
        estimated: false,
      };
    if (
      rules.allowDried &&
      normalize(requirement.ingredient)
        .split(" ")
        .some((word) => FORMS.get(word) === "dried")
    ) {
      return {
        reason:
          "No configured dried-to-fresh quantity conversion; confirm the fresh amount or package count.",
      };
    }
    if (rules.preparedYieldMl !== undefined) {
      if (
        !Number.isFinite(rules.preparedYieldMl) ||
        rules.preparedYieldMl <= 0
      ) {
        return {
          reason: "Invalid prepared-stock yield; clarification required.",
        };
      }
      if (unit !== "ml") {
        return {
          reason: `No configured conversion from ${unit} to prepared ml; clarification required.`,
        };
      }
      return {
        amount: (amount / rules.preparedYieldMl) * pack.amount,
        unit: pack.unit,
        estimated: false,
      };
    }
    if (unit === pack.unit) return { amount, unit, estimated: false };
    if (Number.isFinite(rules.gramsPerItem) && rules.gramsPerItem > 0) {
      if (unit === "g" && pack.unit === "count")
        return {
          amount: amount / rules.gramsPerItem,
          unit: "count",
          estimated: true,
        };
      if (unit === "count" && pack.unit === "g")
        return {
          amount: amount * rules.gramsPerItem,
          unit: "g",
          estimated: true,
        };
    }
    if (Number.isFinite(rules.gramsPerMl) && rules.gramsPerMl > 0) {
      if (unit === "g" && pack.unit === "ml")
        return {
          amount: amount / rules.gramsPerMl,
          unit: "ml",
          estimated: true,
        };
      if (unit === "ml" && pack.unit === "g")
        return {
          amount: amount * rules.gramsPerMl,
          unit: "g",
          estimated: true,
        };
    }
    return {
      reason: `No configured conversion from ${unit} to ${pack.unit}; clarification required.`,
    };
  }
}
