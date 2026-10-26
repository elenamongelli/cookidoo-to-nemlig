import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  comparePrices,
  formatComparison,
  prepareComparison,
} from "../compare-prices.mjs";
import {
  buildHouseholdReview,
  formatHouseholdReview,
  prepareHouseholdOffers,
  recordHouseholdAction,
} from "../household-supplies.mjs";
import {
  approvedPlanMismatch,
  buildApprovedReview,
  buildReviewForInput,
} from "../lib/approved-list.mjs";
import { buildReview, parseList } from "../lib/groceries.mjs";

test("household report presents English actions before references without changing structured data", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../data/household-supplies.json", import.meta.url),
      "utf8",
    ),
  );
  const receipts = [
    { file: "14-10-2026.txt", text: "5601187 Toiletpapir 6 rl. 44,25 1 44,25" },
  ];
  const state = { version: 1, answers: [], offerChecks: [] };
  const report = buildHouseholdReview(config, receipts, state, "2026-10-23");
  const before = JSON.stringify(report);
  const text = formatHouseholdReview(report);
  assert.match(text, /HOUSEHOLD SUPPLIES \| 23 Oct 2026/);
  assert.match(text, /Items: 3 \| Stock questions: 3 \| Offer checks due: 1/);
  assert.match(text, /Toilet paper - Check stock and offers/);
  assert.match(text, /Stock recheck: 28 Oct 2026/);
  assert.match(text, /Offers: check now/);
  assert.match(text, /Do you have enough dish soap\?/);
  assert.match(
    text,
    /Do you have enough kitchen roll\? How often should you restock it\?/,
  );
  assert.ok(
    text.indexOf("Do you have enough toilet paper?") <
      text.indexOf("RECEIPT REFERENCES"),
  );
  assert.match(text, /14-10-2026.txt:1 \| 1 x Toiletpapir 6 rl\./);
  assert.doesNotMatch(
    text,
    /\[watch-offers\]|\[unknown-stock\]|SKU|Hai abbastanza|Scorte casa/,
  );
  assert.equal(JSON.stringify(report), before);
  const enough = recordHouseholdAction(
    state,
    report,
    "toilet-paper",
    "enough",
    "2026-11-10",
  );
  const checked = recordHouseholdAction(
    enough,
    report,
    "toilet-paper",
    "offers-checked",
  );
  const deferred = formatHouseholdReview(
    buildHouseholdReview(config, receipts, checked, "2026-10-23"),
  );
  assert.match(deferred, /UNDER CONTROL/);
  assert.match(deferred, /Next offer check: from 3 Nov 2026/);
  const warning = formatHouseholdReview({
    ...report,
    issues: [{ file: "bad.txt", line: 2, reason: "Invalid receipt date." }],
  });
  assert.match(warning, /WARNINGS\n- bad.txt:2: Invalid receipt date\./);
});

test("household supplies use receipt evidence and open the weekly offer buffer", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../data/household-supplies.json", import.meta.url),
      "utf8",
    ),
  );
  const receipts = [
    {
      file: "14-10-2026.txt",
      text: "5601187 Toiletpapir 6 rl. 44,25 1 44,25\n5066557 Køkkenrulle 4 rl. 16,11 1 16,11",
    },
  ];
  const state = { version: 1, answers: [], offerChecks: [] };
  const review = buildHouseholdReview(config, receipts, state, "2026-10-23");
  const toilet = review.items.find((item) => item.id === "toilet-paper");
  assert.equal(toilet.lastPurchasedOn, "2026-10-14");
  assert.equal(toilet.dueOn, "2026-10-28");
  assert.equal(toilet.watchFrom, "2026-10-21");
  assert.equal(toilet.checkOffers, true);
  assert.match(toilet.question, /Do you have enough toilet paper/);
  assert.equal(toilet.evidence[0].packages, 1);
  assert.equal("price" in toilet.evidence[0], false);
  assert.equal(
    review.items.find((item) => item.id === "dish-soap").status,
    "unknown-stock",
  );
  assert.equal(
    review.items.find((item) => item.id === "kitchen-roll").status,
    "configure-interval",
  );
  assert.equal(
    buildHouseholdReview(config, receipts, state, "2026-10-20").items[0]
      .checkOffers,
    false,
  );
  const checked = recordHouseholdAction(
    state,
    review,
    "toilet-paper",
    "offers-checked",
  );
  assert.equal(
    buildHouseholdReview(config, receipts, checked, "2026-10-29").items[0]
      .checkOffers,
    false,
  );
  assert.equal(
    buildHouseholdReview(config, receipts, checked, "2026-10-30").items[0]
      .checkOffers,
    true,
  );
});

test("household stock answers defer questions and newer receipts reset confirmations", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../data/household-supplies.json", import.meta.url),
      "utf8",
    ),
  );
  const receipts = [
    { file: "14-10-2026.txt", text: "5601187 Toiletpapir 6 rl. 44,25 1 44,25" },
  ];
  const state = { version: 1, answers: [], offerChecks: [] };
  const report = buildHouseholdReview(config, receipts, state, "2026-10-23");
  const enough = recordHouseholdAction(
    state,
    report,
    "toilet-paper",
    "enough",
    "2026-11-10",
  );
  const deferred = buildHouseholdReview(config, receipts, enough, "2026-10-28")
    .items[0];
  assert.equal(deferred.status, "stock-confirmed");
  assert.equal(deferred.question, null);
  assert.equal(deferred.checkOffers, false);
  assert.equal(
    buildHouseholdReview(config, receipts, enough, "2026-11-03").items[0]
      .checkOffers,
    true,
  );
  assert.throws(
    () =>
      recordHouseholdAction(
        state,
        report,
        "toilet-paper",
        "enough",
        "2026-10-22",
      ),
    /after/,
  );
  receipts.push({
    file: "28-10-2026.txt",
    text: "5601187 Toiletpapir 6 rl. 44,25 2 88,50",
  });
  const updated = buildHouseholdReview(config, receipts, enough, "2026-10-28")
    .items[0];
  assert.equal(updated.status, "not-yet");
  assert.equal(updated.dueOn, "2026-11-11");
  assert.equal(updated.evidence[0].packages, 2);
  const needed = recordHouseholdAction(state, report, "dish-soap", "need");
  assert.equal(
    buildHouseholdReview(config, receipts, needed, "2026-10-23").items[1]
      .checkOffers,
    true,
  );
});

test("household schedules use calendar months and flag malformed or future receipt rows", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../data/household-supplies.json", import.meta.url),
      "utf8",
    ),
  );
  const state = { version: 1, answers: [], offerChecks: [] };
  const receipts = [
    {
      file: "31-12-2025.txt",
      text: "1234567 Opvaskemiddel 500 ml 5,00 25,00 1 20,00",
    },
    { file: "14-10-2026.txt", text: "5601187 Toiletpapir cannot parse" },
    { file: "30-10-2026.txt", text: "5601187 Toiletpapir 6 rl. 44,25 1 44,25" },
  ];
  const review = buildHouseholdReview(config, receipts, state, "2026-10-23");
  assert.equal(review.items[1].dueOn, "2026-02-28");
  assert.equal(review.items[0].lastPurchasedOn, null);
  assert.equal(review.issues.length, 2);
  assert.throws(
    () => buildHouseholdReview(config, receipts, state, "2026-02-30"),
    /Invalid calendar/,
  );
  assert.deepEqual(
    review,
    buildHouseholdReview(config, receipts, state, "2026-10-23"),
  );
});

test("household offer snapshots reuse price comparison without treating receipt quantities as stock", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../data/household-supplies.json", import.meta.url),
      "utf8",
    ),
  );
  const receipts = [
    { file: "14-10-2026.txt", text: "5601187 Toiletpapir 6 rl. 44,25 1 44,25" },
  ];
  const state = { version: 1, answers: [], offerChecks: [] };
  const report = buildHouseholdReview(config, receipts, state, "2026-10-23");
  const prepared = prepareHouseholdOffers(report);
  assert.equal(prepared.groups.length, 1);
  assert.deepEqual(prepared.groups[0].required, { amount: 6, unit: "count" });
  assert.match(prepared.groups[0].notes[0], /not measured stock/);
  const snapshot = structuredClone(prepared);
  snapshot.checkedAt = "2026-10-23T12:00:00Z";
  Object.assign(snapshot.groups[0].candidates[0], {
    url: "https://www.nemlig.com/toiletpapir-5601187",
    priceOre: 4425,
    available: true,
    decision: "suitable",
  });
  const compared = comparePrices(snapshot, prepared);
  assert.equal(compared.items[0].recommendation.packages, 1);
  assert.match(
    formatComparison(compared),
    /https:\/\/www.nemlig.com\/toiletpapir-5601187/,
  );
  assert.equal(
    prepareHouseholdOffers(
      buildHouseholdReview(config, receipts, state, "2026-10-20"),
    ).groups.length,
    0,
  );
});

test("price comparison ranks coverage costs, multibuys and stable SKU ties", () => {
  const prepared = prepareComparison(
    "110 g spinach",
    {},
    { sourceSha256: "different" },
  );
  const snapshot = structuredClone(prepared);
  snapshot.checkedAt = "2026-10-23T12:00:00Z";
  const candidate = (sku, amount, priceOre, extra = {}) => ({
    sku,
    name: "Fresh spinach",
    url: `https://www.nemlig.com/spinat-${sku}`,
    pack: { amount, unit: "g" },
    priceOre,
    available: true,
    decision: "suitable",
    ...extra,
  });
  snapshot.groups[0].candidates = [
    candidate("200", 100, 1500),
    candidate("100", 250, 1900),
  ];
  const report = comparePrices(snapshot, prepared);
  assert.equal(report.items[0].recommendation.sku, "100");
  assert.equal(report.items[0].recommendation.packages, 1);
  assert.equal(report.items[0].recommendation.excess, 140);
  assert.equal(report.items[0].savingOre, null);
  assert.match(
    formatComparison(report),
    /\[Fresh spinach\]\(https:\/\/www.nemlig.com\/spinat-100\)/,
  );
  assert.match(formatComparison(report), /1 x 250 g/);
  snapshot.groups[0].candidates.push(candidate("050", 250, 1900));
  assert.equal(
    comparePrices(snapshot, prepared).items[0].recommendation.sku,
    "050",
  );
  const firstOrder = comparePrices(snapshot, prepared).items[0].alternatives;
  snapshot.groups[0].candidates.reverse();
  assert.deepEqual(
    comparePrices(snapshot, prepared).items[0].alternatives,
    firstOrder,
  );
  snapshot.groups[0].candidates = [
    candidate("200", 100, 1500, {
      multibuy: { packs: 3, priceOre: 2500, sameSku: true },
    }),
  ];
  assert.equal(
    comparePrices(snapshot, prepared).items[0].recommendation.packages,
    3,
  );
  assert.equal(
    comparePrices(snapshot, prepared).items[0].recommendation.totalCostOre,
    2500,
  );
  snapshot.groups[0].candidates[0].multibuy.sameSku = false;
  assert.equal(comparePrices(snapshot, prepared).items[0].status, "unresolved");
});

test("price comparison verifies baselines, deposits, price metadata and direct links", () => {
  const prepared = prepareComparison(
    "500 g rice",
    {
      123: { name: "Rice 500 g", aliases: { en: ["rice"] } },
    },
    { sourceSha256: "different" },
  );
  const snapshot = structuredClone(prepared);
  snapshot.checkedAt = "2026-10-23T12:00:00Z";
  Object.assign(snapshot.groups[0].candidates[0], {
    url: "https://www.nemlig.com/rice-123",
    priceOre: 2000,
    available: true,
    decision: "suitable",
  });
  snapshot.groups[0].candidates.push({
    ...snapshot.groups[0].candidates[0],
    sku: "124",
    url: "https://www.nemlig.com/rice-124",
    priceOre: 1500,
    depositOre: 100,
  });
  const result = comparePrices(snapshot, prepared).items[0];
  assert.equal(result.recommendation.totalCostOre, 1600);
  assert.equal(result.recommendation.depositCostOre, 100);
  assert.equal(result.savingOre, 400);
  snapshot.groups[0].candidates[1].priceOre = 15.5;
  assert.equal(
    comparePrices(snapshot, prepared).items[0].recommendation.sku,
    "123",
  );
  snapshot.groups[0].candidates[0].url = "https://www.nemlig.com/?search=rice";
  assert.equal(comparePrices(snapshot, prepared).items[0].status, "unresolved");
});

test("price comparison rejects changed inputs, unsupported conversions and unapproved alternatives", () => {
  const prepared = prepareComparison(
    "2 sprigs dill",
    {},
    { sourceSha256: "different" },
  );
  const snapshot = structuredClone(prepared);
  snapshot.checkedAt = "2026-10-23T12:00:00Z";
  snapshot.groups[0].candidates = [
    {
      sku: "123",
      name: "Dill",
      url: "https://www.nemlig.com/dild-123",
      pack: { amount: 25, unit: "g" },
      priceOre: 1200,
      available: true,
      decision: "suitable",
    },
  ];
  assert.equal(comparePrices(snapshot, prepared).items[0].status, "unresolved");
  snapshot.groups[0].candidates[0].decision = "approval-needed";
  assert.equal(
    comparePrices(snapshot, prepared).items[0].pending[0].decision,
    "approval-needed",
  );
  snapshot.inputSha256 = "changed";
  assert.throws(() => comparePrices(snapshot, prepared), /does not match/);
  snapshot.inputSha256 = prepared.inputSha256;
  snapshot.groups[0].required = { amount: 2, unit: "g" };
  assert.throws(
    () => comparePrices(snapshot, prepared),
    /requirements changed/,
  );
});

test("price comparison preserves approved supplied quantities without inventing conversions", () => {
  const text = "500 g rice";
  const dictionary = { 123: { name: "Rice 500 g", aliases: { en: ["rice"] } } };
  const fingerprint = (value) =>
    createHash("sha256").update(value).digest("hex");
  const decisions = {
    sourceSha256: fingerprint(text),
    productsSha256: fingerprint(JSON.stringify([["123", "Rice 500 g", null]])),
    purchases: [["123", 2, [1]]],
    excluded: [],
    estimatedSkus: [],
    substitutions: {},
  };
  const prepared = prepareComparison(text, dictionary, decisions);
  assert.deepEqual(prepared.groups[0].required, { amount: 1000, unit: "g" });
  assert.match(prepared.groups[0].notes[0], /approved supply/);
  const snapshot = structuredClone(prepared);
  snapshot.checkedAt = "2026-10-23T12:00:00Z";
  Object.assign(snapshot.groups[0].candidates[0], {
    url: "https://www.nemlig.com/rice-123",
    priceOre: 1000,
    available: true,
    decision: "suitable",
  });
  assert.equal(
    comparePrices(snapshot, prepared).items[0].recommendation.packages,
    2,
  );
});

test("weight-volume conversion uses explicit estimates only", () => {
  const dictionary = {
    liquid: {
      name: "Liquid 1 l",
      aliases: { en: ["liquid"] },
      rules: { gramsPerMl: 1.2 },
    },
  };
  const review = buildReview("600 g liquid", dictionary);
  assert.equal(review.items[0].required.amount, 500);
  assert.equal(review.items[0].packages, 1);
  assert.equal(review.items[0].estimated, true);
  delete dictionary.liquid.rules;
  assert.equal(buildReview("600 g liquid", dictionary).unresolved.length, 1);
});

test("unitless aromatic herb quantities mean leaves, but explicit units take precedence", () => {
  const result = parseList(
    "5 fresh basil\n5 basilico fresco\n5 albahaca fresca\n5 frisk basilikum\n3 sprigs fresh basil\n20 g fresh coriander",
  );
  assert.deepEqual(
    result.map((item) => item.unit),
    ["leaf", "leaf", "leaf", "leaf", "sprig", "g"],
  );
  const dictionary = {
    herb: { name: "Basil 20 g", aliases: { en: ["basil"] } },
  };
  assert.match(
    buildReview("5 basil", dictionary).unresolved[0].reason,
    /leaf to g/,
  );
});

test("invalid or missing pack metadata never produces a purchase quantity", () => {
  for (const pack of [
    { amount: 0, unit: "g" },
    { amount: 100, unit: "mystery" },
  ]) {
    const review = buildReview("100 g rice", {
      rice: { name: "Rice", pack, aliases: { en: ["rice"] } },
    });
    assert.equal(review.items.length, 0);
    assert.match(review.unresolved[0].reason, /pack size/);
  }
});

const products = JSON.parse(
  readFileSync(new URL("../data/products.json", import.meta.url), "utf8"),
);
const approvedList = JSON.parse(
  readFileSync(new URL("../data/approved-list.json", import.meta.url), "utf8"),
);

function itemFor(text, sku) {
  return buildReview(text, products).items.find((item) => item.sku === sku);
}

test("approved feta preference uses the drained cheese weight rather than brine", () => {
  for (const ingredient of ["feta", "feta cheese", "fetaost", "queso feta"]) {
    const item = itemFor(`150 g ${ingredient}`, "5067098");
    assert.equal(item.packages, 1);
    assert.deepEqual(item.pack, { amount: 200, unit: "g" });
    assert.equal(item.provenance, "preferred");
  }
  assert.equal(itemFor("250 g feta cheese", "5067098").packages, 2);
});

test("approved seeds, cranberries, and smaller coconut water have multilingual aliases and pack sizes", () => {
  const cases = [
    [
      "5062611",
      "100 g",
      { amount: 250, unit: "g" },
      ["semi di lino", "flaxseed", "h\u00f8rfr\u00f8", "semillas de lino"],
    ],
    [
      "5062103",
      "100 g",
      { amount: 100, unit: "g" },
      [
        "mirtilli rossi",
        "dried cranberries",
        "traneb\u00e6r",
        "ar\u00e1ndanos rojos",
      ],
    ],
    [
      "5062609",
      "100 g",
      { amount: 250, unit: "g" },
      [
        "semi di zucca",
        "pumpkin seeds",
        "gr\u00e6skarkerner",
        "semillas de calabaza",
      ],
    ],
    [
      "5051480",
      "175 ml",
      { amount: 500, unit: "ml" },
      ["acqua di cocco", "coconut water", "kokosvand", "agua de coco"],
    ],
  ];
  for (const [sku, quantity, pack, aliases] of cases) {
    for (const alias of aliases) {
      const item = itemFor(`${quantity} ${alias}`, sku);
      assert.deepEqual(item.pack, pack);
      assert.equal(item.packages, 1);
      assert.equal(item.provenance, "preferred");
    }
  }
});

test("cooking cream uses the approved AMA alternative without assuming a density", () => {
  for (const ingredient of [
    "panna da cucina",
    "cooking cream",
    "single cream",
    "madlavningsfl\u00f8de",
    "nata para cocinar",
  ]) {
    const item = itemFor(`600 ml ${ingredient}`, "5060793");
    assert.deepEqual(item.pack, { amount: 330, unit: "ml" });
    assert.equal(item.packages, 2);
  }
  const review = buildReview("550 - 600 g single cream", products);
  assert.equal(review.items.length, 0);
  assert.deepEqual(review.unresolved[0].candidateSkus, ["5060793"]);
  assert.match(review.unresolved[0].reason, /No configured conversion/);
  assert.equal(buildReview("300 ml whipping cream", products).items.length, 0);
});

test("yogurt uses preferred skyr and preserves every contributing source reference", () => {
  for (const alias of [
    "yogurt naturale",
    "natural yogurt",
    "yoghurt naturel",
    "yogur natural",
  ]) {
    const item = itemFor(`125 g ${alias}`, "5053034");
    assert.deepEqual(item.pack, { amount: 1000, unit: "g" });
    assert.equal(item.packages, 1);
  }
  const category = "DAIRY PRODUCTS INCL. BUTTER";
  const originals = ["125 g yogurt naturale", "100 g natural yogurt"];
  const review = buildReview([category, ...originals].join("\n"), products);
  const item = review.items[0];
  assert.equal(item.sku, "5053034");
  assert.equal(item.required.amount, 225);
  assert.equal(item.packages, 1);
  assert.deepEqual(
    item.requirements.map((requirement) => ({
      line: requirement.line,
      original: requirement.original,
    })),
    [
      { line: 2, original: originals[0] },
      { line: 3, original: originals[1] },
    ],
  );
});

test("approved fresh mussels match the original Spanish requirement and retain its reference", () => {
  const original = "500 g de mejillones frescos limpios";
  const item = itemFor(original, "5052676");
  assert.deepEqual(item.pack, { amount: 1000, unit: "g" });
  assert.equal(item.packages, 1);
  assert.equal(item.required.amount, 500);
  assert.equal(item.requirements[0].original, original);
  for (const alias of [
    "cozze",
    "fresh cleaned mussels",
    "bl\u00e5muslinger",
    "mejillones",
  ]) {
    assert.equal(itemFor(`500 g ${alias}`, "5052676").packages, 1);
  }
  assert.equal(buildReview("500 g canned mussels", products).items.length, 0);
  assert.equal(buildReview("500 g clams", products).items.length, 0);
});

test("approved ice uses a 2 kg bag without inventing a weight per cube", () => {
  for (const alias of [
    "cubetti di ghiaccio",
    "ice cubes",
    "isterninger",
    "cubitos de hielo",
  ]) {
    const item = itemFor(`100 g ${alias}`, "5050278");
    assert.deepEqual(item.pack, { amount: 2000, unit: "g" });
    assert.equal(item.packages, 1);
  }
  const original = "3 cubetti di ghiaccio";
  const review = buildReview(original, products);
  assert.equal(review.items.length, 0);
  assert.deepEqual(review.unresolved[0].candidateSkus, ["5050278"]);
  assert.equal(review.unresolved[0].original, original);
  assert.match(review.unresolved[0].reason, /No configured conversion/);
});

test("approved frozen peas use the 575 g pack without approving fresh substitution", () => {
  for (const alias of [
    "piselli",
    "frozen green peas",
    "\u00e6rter",
    "guisantes verdes",
  ]) {
    const item = itemFor(`450 g ${alias}`, "801007");
    assert.deepEqual(item.pack, { amount: 575, unit: "g" });
    assert.equal(item.packages, 1);
    assert.equal(item.requirements[0].original, `450 g ${alias}`);
  }
  assert.equal(itemFor("600 g frozen green peas", "801007").packages, 2);
  assert.equal(buildReview("450 g fresh green peas", products).items.length, 0);
});

test("approved Conference pear resolves counts without inventing a weight estimate", () => {
  for (const alias of ["pera", "pear", "p\u00e6re", "pera conferencia"]) {
    const item = itemFor(`1 ${alias}`, "2301133");
    assert.deepEqual(item.pack, { amount: 1, unit: "count" });
    assert.equal(item.packages, 1);
    assert.equal(item.requirements[0].original, `1 ${alias}`);
  }
  assert.equal(itemFor("2 pears", "2301133").packages, 2);
  const review = buildReview("100 g pear", products);
  assert.equal(review.items.length, 0);
  assert.deepEqual(review.unresolved[0].candidateSkus, ["2301133"]);
  assert.match(review.unresolved[0].reason, /No configured conversion/);
});

test("approved vegetable fond replaces fish stock using its labelled two-litre yield", () => {
  for (const alias of [
    "fumetto di pesce",
    "fish stock",
    "fiskefond",
    "fumet de pescado",
  ]) {
    const item = itemFor(`700 ml ${alias}`, "5008330");
    assert.deepEqual(item.pack, { amount: 112, unit: "g" });
    assert.equal(item.packages, 1);
    assert.equal(item.requirements[0].original, `700 ml ${alias}`);
  }
  assert.equal(products["5008330"].rules.preparedYieldMl, 2000);
  assert.equal(products["5029901"], undefined);
  assert.equal(itemFor("2500 ml fish stock", "5008330").packages, 2);
  assert.equal(itemFor("1 packs fish stock", "5008330").packages, 1);
  const original = "700 g de fumet de pescado";
  const review = buildReview(original, products);
  assert.equal(review.items.length, 0);
  assert.deepEqual(review.unresolved[0].candidateSkus, ["5008330"]);
  assert.equal(review.unresolved[0].original, original);
  assert.match(
    review.unresolved[0].reason,
    /No configured conversion from g to prepared ml/,
  );
});

test("approved Dijon uses the Maille jar without inventing a teaspoon conversion", () => {
  for (const alias of [
    "senape dijon",
    "Dijon mustard",
    "dijonsennep",
    "mostaza de dijon",
  ]) {
    const item = itemFor(`100 g ${alias}`, "105322");
    assert.deepEqual(item.pack, { amount: 380, unit: "g" });
    assert.equal(item.packages, 1);
  }
  const original = "1 tsp Dijon mustard";
  const review = buildReview(original, products);
  assert.equal(review.items.length, 0);
  assert.deepEqual(review.unresolved[0].candidateSkus, ["105322"]);
  assert.equal(review.unresolved[0].original, original);
  assert.match(review.unresolved[0].reason, /No configured conversion/);
});

test("approved whole black pepper remains distinct from ground pepper and spoon quantities", () => {
  for (const alias of [
    "pepe nero in grani",
    "black peppercorns",
    "sorte peberkorn",
    "pimienta negra en grano",
  ]) {
    const item = itemFor(`10 g ${alias}`, "5051156");
    assert.deepEqual(item.pack, { amount: 100, unit: "g" });
    assert.equal(item.packages, 1);
  }
  const original = "1 tsp black peppercorns";
  const review = buildReview(original, products);
  assert.equal(review.items.length, 0);
  assert.deepEqual(review.unresolved[0].candidateSkus, ["5051156"]);
  assert.equal(review.unresolved[0].original, original);
  assert.match(review.unresolved[0].reason, /No configured conversion/);
  assert.equal(itemFor("10 g ground black pepper", "5051157").packages, 1);
});

test("approved salmon alternatives use the confirmed fillet estimate and preserve source wording", () => {
  const skus = ["5046333", "5061370", "5602181"];
  const original = "600 g fresh salmon fillets, skinless";
  const review = buildReview(original, products);
  assert.equal(review.items.length, 0);
  assert.deepEqual(review.unresolved[0].candidateSkus.sort(), skus);
  for (const sku of skus) {
    const selected = { [sku]: products[sku] };
    const item = buildReview(original, selected).items[0];
    assert.equal(item.requirements[0].original, original);
    assert.equal(item.pack.amount, sku === "5046333" ? 225 : 600);
    assert.equal(buildReview("600 g smoked salmon", selected).items.length, 0);
    assert.equal(buildReview("600 g frozen salmon", selected).items.length, 0);
  }
  const countedOriginal = "4 filetti di salmone, freschi, senza pelle";
  const counted = buildReview(`${countedOriginal}\n${original}`, {
    5602181: products["5602181"],
  });
  assert.equal(counted.unresolved.length, 0);
  assert.equal(counted.items.length, 1);
  assert.equal(counted.items[0].required.amount, 1200);
  assert.equal(counted.items[0].packages, 2);
  assert.equal(counted.items[0].estimated, true);
  assert.deepEqual(
    counted.items[0].requirements.map((requirement) => requirement.original),
    [countedOriginal, original],
  );
  for (const sku of skus) assert.equal(products[sku].rules.gramsPerItem, 150);
  const withoutEstimate = {
    ...products["5602181"],
    rules: { ...products["5602181"].rules },
  };
  delete withoutEstimate.rules.gramsPerItem;
  const unresolved = buildReview(countedOriginal, { 5602181: withoutEstimate });
  assert.equal(unresolved.items.length, 0);
  assert.match(unresolved.unresolved[0].reason, /No configured conversion/);
});

test("approved chilli powder and prawns do not invent spoon or count conversions", () => {
  assert.equal(itemFor("10 g Kashmiri chilli powder", "5034904").packages, 1);
  assert.equal(itemFor("100 g gambones", "5060560").packages, 1);
  const powder = buildReview("0.25 tsp Kashmiri chilli powder", products);
  assert.equal(powder.items.length, 0);
  assert.deepEqual(powder.unresolved[0].candidateSkus, ["5034904"]);
  const prawns = buildReview("6 gambones crudos enteros", products);
  assert.equal(prawns.items.length, 0);
  assert.equal(prawns.unresolved[0].original, "6 gambones crudos enteros");
});

test("approved pepper estimate combines both original requirements before rounding", () => {
  const item = itemFor("160 g peppers\n100 g red capsicum", "2301103");
  assert.equal(item.packages, 3);
  assert.equal(item.estimated, true);
  assert.equal(item.requirements.length, 2);
});

test("approved canned tomatoes use Mutti without replacing fresh tomatoes or puree", () => {
  for (const alias of [
    "pomodori in scatola",
    "canned tomatoes",
    "hakkede tomater",
    "tomate triturado en conserva",
  ]) {
    const item = itemFor(`100 g ${alias}`, "5066376");
    assert.deepEqual(item.pack, { amount: 400, unit: "g" });
    assert.equal(item.packages, 1);
    assert.equal(item.requirements[0].original, `100 g ${alias}`);
  }
  assert.equal(itemFor("450 g canned tomatoes", "5066376").packages, 2);
  assert.equal(itemFor("100 g tomatoes", "106499").packages, 1);
  assert.equal(itemFor("95 g tomato puree", "5602312").packages, 1);
});

test("approved concentrated tomato puree uses its own 140 g pack", () => {
  for (const alias of [
    "concentrato di pomodoro",
    "tomato pur\u00e9e",
    "tomatpur\u00e9",
    "concentrado de tomate",
  ]) {
    const item = itemFor(`95 g ${alias}`, "5602312");
    assert.deepEqual(item.pack, { amount: 140, unit: "g" });
    assert.equal(item.packages, 1);
    assert.equal(item.requirements[0].original, `95 g ${alias}`);
  }
  assert.equal(itemFor("150 g tomato paste", "5602312").packages, 2);
  assert.equal(buildReview("100 g passata", products).items.length, 0);
});

test("approved champignons replace dried mushrooms without treating dried grams as fresh grams", () => {
  for (const alias of ["champignon", "button mushrooms", "champi\u00f1ones"]) {
    const item = itemFor(`100 g ${alias}`, "5010800");
    assert.deepEqual(item.pack, { amount: 500, unit: "g" });
    assert.equal(item.packages, 1);
  }
  for (const alias of [
    "funghi porcini secchi",
    "funghi secchi",
    "dried mushrooms",
    "t\u00f8rrede svampe",
    "setas secas",
  ]) {
    const original = `20 g ${alias}`;
    const review = buildReview(original, products);
    assert.equal(review.items.length, 0);
    assert.deepEqual(review.unresolved[0].candidateSkus, ["5010800"]);
    assert.equal(review.unresolved[0].original, original);
    assert.match(
      review.unresolved[0].reason,
      /dried-to-fresh quantity conversion/,
    );
  }
  const explicit = itemFor("1 packs dried mushrooms", "5010800");
  assert.equal(explicit.packages, 1);
  assert.ok(
    explicit.substitutions.some((note) =>
      note.includes("dried mushrooms to fresh"),
    ),
  );
});

test("lemon and lime use preferred bottled lime juice without guessing fruit yield", () => {
  for (const alias of [
    "succo di limone",
    "lemon juice",
    "lime juice",
    "citronsaft",
    "zumo de lim\u00f3n",
  ]) {
    const item = itemFor(`25 ml ${alias}`, "5047224");
    assert.deepEqual(item.pack, { amount: 250, unit: "ml" });
    assert.equal(item.packages, 1);
  }
  for (const alias of ["lemon", "lime", "limone", "citron", "lim\u00f3n"]) {
    const original = `0.5 ${alias}`;
    const review = buildReview(original, products);
    assert.equal(review.items.length, 0);
    assert.deepEqual(review.unresolved[0].candidateSkus, ["5047224"]);
    assert.equal(review.unresolved[0].original, original);
    assert.match(review.unresolved[0].reason, /No configured conversion/);
  }
  for (const original of [
    "1 lemon zest",
    "1 lime slices",
    "1 scorza di limone",
    "1 citronskal",
    "1 rodajas de lima",
  ]) {
    const review = buildReview(original, products);
    assert.equal(review.items.length, 0);
    assert.deepEqual(review.unresolved[0].candidateSkus, ["5047224"]);
    assert.equal(review.unresolved[0].original, original);
    assert.match(review.unresolved[0].reason, /No configured conversion/);
  }
});

test("approved hard-cheese alternatives use the first saved match", () => {
  for (const alias of [
    "parmigiano reggiano",
    "parmesan cheese",
    "parmesanost",
    "queso parmesano",
    "hard cheese",
  ]) {
    const review = buildReview(`100 g ${alias}`, products);
    assert.equal(review.unresolved.length, 0);
    assert.equal(review.items[0].sku, "5064676");
    assert.equal(review.items[0].packages, 1);
  }
  assert.equal(itemFor("150 g Grana Padano", "5064676").packages, 1);
});

test("selecting approved Grana Padano covers all Parmesan and hard-cheese lines together", () => {
  const text =
    "40 g di Parmigiano Reggiano\n150 g di Parmigiano Reggiano, a pezzi\n150 g hard cheese";
  const selected = { 5064676: products["5064676"] };
  const review = buildReview(text, selected);
  assert.equal(review.unresolved.length, 0);
  assert.equal(review.items.length, 1);
  const item = review.items[0];
  assert.equal(item.sku, "5064676");
  assert.equal(item.required.amount, 340);
  assert.deepEqual(item.pack, { amount: 200, unit: "g" });
  assert.equal(item.packages, 2);
  assert.deepEqual(
    item.requirements.map((requirement) => requirement.original),
    text.split("\n"),
  );
});

test("orange juice resolves to the approved cold-pressed bottle across languages", () => {
  for (const ingredient of [
    "succo d'arancia",
    "orange juice",
    "appelsinjuice",
    "zumo de naranja",
  ]) {
    const item = itemFor(`300 ml ${ingredient}`, "5065466");
    assert.deepEqual(item.pack, { amount: 750, unit: "ml" });
    assert.equal(item.packages, 1);
  }
  assert.equal(products["5065466"].rules.coldPressed, true);
  assert.equal(products["5065466"].rules.fromConcentrate, false);
  const byWeight = buildReview("300 g di succo d'arancia", products);
  assert.equal(byWeight.items.length, 0);
  assert.deepEqual(byWeight.unresolved[0].candidateSkus, ["5065466"]);
  assert.match(byWeight.unresolved[0].reason, /No configured conversion/);
  assert.equal(
    buildReview("300 ml orange juice from concentrate", products).items.length,
    0,
  );
});

test("rice preferences choose the first saved match and preserve specific aliases", () => {
  for (const ingredient of ["riso", "rice", "ris", "arroz de grano redondo"]) {
    const review = buildReview(`350 g ${ingredient}`, products);
    assert.equal(review.unresolved.length, 0);
    assert.equal(review.items[0].sku, "5064707");
    assert.equal(review.items[0].packages, 1);
  }
  for (const [ingredient, sku] of [
    ["parboiled rice", "5064707"],
    ["jasmine rice", "5603865"],
  ]) {
    const item = itemFor(`350 g ${ingredient}`, sku);
    assert.deepEqual(item.pack, { amount: 1000, unit: "g" });
    assert.equal(item.packages, 1);
  }
});

test("saving approved products does not invent spoon or liquid-density conversions", () => {
  const review = buildReview(
    "1 cucchiaino di semi di lino\n2 Tbsp dried cranberries\n1 Tbsp pumpkin seeds\n175 g acqua di cocco",
    products,
  );
  assert.equal(review.items.length, 0);
  assert.deepEqual(
    review.unresolved.map((item) => item.candidateSkus),
    [["5062611"], ["5062103"], ["5062609"], ["5051480"]],
  );
  assert.ok(
    review.unresolved.every((item) =>
      /No configured conversion/.test(item.reason),
    ),
  );
});

test("preserves source lines while ignoring headings and blanks", () => {
  const result = parseList("  FRUITS\n\n  150 g banana\n  1 mela");
  assert.equal(result.length, 2);
  assert.equal(result[0].original, "150 g banana");
  assert.equal("category" in result[0], false);
  assert.equal(result[0].line, 3);
  assert.equal(result[1].unit, "count");
});

test("takes range upper bounds, decimal commas, and normalized weight/volume units", () => {
  const result = parseList(
    "550 - 600 g single cream\n0,5 kg potatoes\n1.5 l milk\n0.75 - 1.25 dried chillies",
  );
  assert.deepEqual(
    result.map((item) => [item.amount, item.unit]),
    [
      [600, "g"],
      [500, "g"],
      [1500, "ml"],
      [1.25, "count"],
    ],
  );
});

test("parses Italian and Spanish units without discarding ingredient qualifiers", () => {
  const result = parseList(
    "1 cucchiaino di sale\n0.5 cucharadita de pimenton\n110 g di foglie di spinaci freschi",
  );
  assert.equal(result[0].unit, "tsp");
  assert.equal(result[0].ingredient, "sale");
  assert.equal(result[1].ingredient, "pimenton");
  assert.equal(result[2].ingredient, "foglie di spinaci freschi");
});

test("retains malformed lines as unresolved instead of silently omitting them", () => {
  const result = parseList("some milk\n0 eggs\n5 - 2 g banana\n100 g");
  assert.equal(result.length, 4);
  assert.ok(result.every((item) => item.status === "unresolved"));
});

test("does not silently classify an unknown uppercase ingredient as a heading", () => {
  assert.equal(parseList("BANANA")[0].status, "unresolved");
});

test("rounds eggs and chicken to whole packs", () => {
  assert.equal(itemFor("10 eggs", "5602879").packages, 2);
  assert.equal(itemFor("500 g chicken breasts", "5056391").packages, 1);
});

test("combines requirements before rounding and retains all contributing lines", () => {
  const item = itemFor("4 eggs\n4 eggs", "5602879");
  assert.equal(item.packages, 1);
  assert.equal(item.requirements.length, 2);
});

test("groups onions and shallots across supported languages", () => {
  const item = itemFor(
    "100 g di scalogno\n50 g red onions\n210 g onions\n50 g brown onion\n100 g cebolla\n100 g skalottel\u00f8g",
    "2301108",
  );
  assert.equal(item.required.amount, 610);
  assert.equal(item.packages, 1);
  assert.equal(item.requirements.length, 6);
  assert.ok(item.substitutions.length > 0);
});

test("uses edible banana estimates and combines weight and count requirements", () => {
  assert.equal(itemFor("150 g banana", "2301138").packages, 2);
  const item = itemFor("150 g banana\n0.5 banana", "2301138");
  assert.equal(item.packages, 2);
  assert.equal(item.estimated, true);
});

test("unitless milk means litres in every configured language", () => {
  for (const milk of ["milk", "latte", "m\u00e6lk", "leche"]) {
    assert.equal(itemFor(`3 ${milk}`, "5019859").packages, 3);
  }
});

test("approved fresh-to-frozen rules preserve and report substitutions", () => {
  for (const [text, sku] of [
    ["110 g di foglie di spinaci freschi", "801005"],
    ["400 g fresh broccoli", "5060611"],
    ["200 g mango fresco", "5605324"],
    ["400 g br\u00f3coli fresco", "5060611"],
  ]) {
    const item = itemFor(text, sku);
    assert.equal(item.packages, 1);
    assert.equal(item.substitutions.length, 1);
    assert.equal(item.requirements[0].original, text);
  }
});

test("dried forms, composite foods, and unsupported conversions stay unresolved", () => {
  const review = buildReview(
    "10 g dried onions\n20 g di funghi secchi\n100 g milk chocolate\n100 g di gambo di sedano\n100 g milk\n100 g coconut milk powder",
    products,
  );
  assert.equal(review.items.length, 0);
  assert.equal(review.excluded.length, 1);
  assert.equal(review.unresolved.length, 5);
  assert.match(review.unresolved[3].reason, /conversion/);
});

test("standing exclusions apply to supported languages and retain source lines", () => {
  const review = buildReview(
    "0.5 tsp food colouring\n10 g di colorante alimentare\n10 g de cebolla deshidratada\n10 g di cipolle essiccate\n10 g friske blandede urter\n10 g erbe aromatiche miste fresche",
    products,
  );
  assert.equal(review.items.length, 0);
  assert.equal(review.unresolved.length, 0);
  assert.deepEqual(
    review.excluded.map((item) => item.line),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    review.excluded.map((item) => item.status),
    ["excluded", "excluded", "excluded", "excluded", "excluded", "excluded"],
  );
});

test("uses the first preferred match for Danish and multilingual aliases without matching partial words", () => {
  const dictionary = {
    first: { name: "First 100 g", aliases: { en: ["rice"], da: ["ris"] } },
    second: { name: "Second 100 g", aliases: { en: ["rice"], da: ["ris"] } },
  };
  for (const ingredient of ["rice", "ris"]) {
    const review = buildReview(
      `100 g ${ingredient}\n100 g licorice`,
      dictionary,
    );
    assert.equal(review.items.length, 1);
    assert.equal(review.items[0].sku, "first");
    assert.equal(review.items[0].packages, 1);
    assert.equal(
      review.items[0].requirements[0].original,
      `100 g ${ingredient}`,
    );
    assert.equal(review.unresolved.length, 1);
    assert.equal(review.unresolved[0].line, 2);
    assert.match(review.unresolved[0].reason, /No preferred/);
  }
});

test("first-match selection retains form and conversion safeguards", () => {
  const dictionary = {
    first: {
      name: "First 100 g",
      rules: { form: "fresh" },
      aliases: { en: ["berry"] },
    },
    second: {
      name: "Second 100 g",
      rules: { form: "frozen" },
      aliases: { en: ["berry"] },
    },
  };
  for (const [text, reason] of [
    ["100 g frozen berry", /Requested form 'frozen' is not approved/],
    ["1 tbsp berry", /No configured conversion/],
  ]) {
    const review = buildReview(text, dictionary);
    assert.equal(review.items.length, 0);
    assert.deepEqual(review.unresolved[0].candidateSkus, ["first"]);
    assert.match(review.unresolved[0].reason, reason);
  }
});

test("reads multipack volumes and preserves explicit package counts", () => {
  const dictionary = {
    drink: { name: "Drink 8 x 0,50 l", aliases: { en: ["drink"] } },
  };
  const item = buildReview("5 l drink\n1 packs drink", dictionary).items[0];
  assert.deepEqual(item.pack, { amount: 4000, unit: "ml" });
  assert.equal(item.packages, 3);
});

test("product packs share weight and volume conversions with grocery quantities", () => {
  const cases = [
    ["250 g", "500 g", { amount: 250, unit: "g" }, 2],
    ["0,5 kg", "1 kg", { amount: 500, unit: "g" }, 2],
    ["250 ml", "0.5 l", { amount: 250, unit: "ml" }, 2],
    ["25 cl", "500 ml", { amount: 250, unit: "ml" }, 2],
    ["0,5 l", "1 l", { amount: 500, unit: "ml" }, 2],
    ["8 stk.", "10", { amount: 8, unit: "count" }, 2],
    ["4 rl.", "5", { amount: 4, unit: "count" }, 2],
  ];
  for (const [size, quantity, pack, packages] of cases) {
    const dictionary = {
      product: { name: `Product ${size}`, aliases: { en: ["product"] } },
    };
    const review = buildReview(`${quantity} product`, dictionary);
    assert.equal(review.unresolved.length, 0, size);
    assert.deepEqual(review.items[0].pack, pack, size);
    assert.equal(review.items[0].packages, packages, size);
  }
});

test("dry run never claims basket changes or import readiness", () => {
  const review = buildReview("1 mela", products);
  assert.equal(review.basketChanged, false);
  assert.equal(review.importReady, false);
  assert.equal(review.items[0].priceAndAvailability, "not-checked");
  const partial = buildReview("1 mela\n100 g unknown", products);
  assert.equal(partial.unresolved.length, 1);
  assert.equal(
    partial.importUrl,
    "https://www.nemlig.com/basket?topup=email&skus=2301197-1",
  );
});

test("sample list accounts for every ingredient and exercises agreed quantities", () => {
  const text = readFileSync(
    new URL("../data/shopping_list", import.meta.url),
    "utf8",
  );
  const review = buildReview(text, products);
  const accounted = [
    ...review.items.flatMap((item) => item.requirements),
    ...review.unresolved,
    ...review.excluded,
  ];
  assert.equal(accounted.length, review.requirementCount);
  assert.equal(
    new Set(accounted.map((item) => item.line)).size,
    review.requirementCount,
  );
  const onions = review.items.find((item) => item.sku === "2301108");
  assert.equal(onions.required.amount, 410);
  assert.equal(onions.packages, 1);
  assert.equal(review.items.find((item) => item.sku === "106499").packages, 3);
  assert.equal(review.items.find((item) => item.sku === "5019859").packages, 3);
  assert.ok(
    review.excluded.some((item) => item.original === "10 g dried onions"),
  );
});

test("approved current-list decisions preserve full source coverage and link only selections", () => {
  const text = readFileSync(
    new URL("../data/shopping_list", import.meta.url),
    "utf8",
  );
  const review = buildApprovedReview(text, products, approvedList);
  assert.ok(review);
  assert.equal(review.items.length, 60);
  assert.equal(
    review.items.reduce((sum, item) => sum + item.packages, 0),
    71,
  );
  assert.equal(review.excluded.length, 7);
  assert.equal(review.unresolved.length, 0);
  assert.equal(review.importReady, false);
  assert.equal(review.basketChanged, false);
  assert.ok(review.items.find((item) => item.sku === "2301138").estimated);
  assert.ok(
    review.items
      .find((item) => item.sku === "801005")
      .substitutions.includes("Standing preference: fresh spinach to frozen."),
  );
  assert.ok(
    review.items
      .find((item) => item.sku === "923155")
      .substitutions.includes(
        "Standing preference: fresh green beans to frozen.",
      ),
  );
  assert.deepEqual(
    review.items
      .find((item) => item.sku === "5047224")
      .requirements.map((item) => item.line),
    [65],
  );

  const accounted = [
    ...review.items.flatMap((item) => item.requirements),
    ...review.excluded,
  ];
  assert.equal(accounted.length, 85);
  assert.deepEqual(
    accounted.map((item) => item.line).sort((left, right) => left - right),
    parseList(text)
      .map((item) => item.line)
      .sort((left, right) => left - right),
  );
  assert.match(review.importUrl, /skus=5013957-1,2301138-2/);
  assert.equal(approvedPlanMismatch(text, products, approvedList), null);
  const alteredLine = text.replace(/^([^\r\n]*)/, "$1 ");
  assert.match(
    approvedPlanMismatch(alteredLine, products, approvedList),
    /shopping-list text differs/,
  );
  const fallback = buildReviewForInput(alteredLine, products, approvedList);
  assert.match(fallback.planNotice, /shopping-list text differs/);
  assert.ok(fallback.importUrl);
  const leadingBlankFallback = buildReviewForInput(
    `\n${text}`,
    products,
    approvedList,
  );
  assert.match(leadingBlankFallback.planNotice, /shopping-list text differs/);
  const changedProducts = {
    ...products,
    5013957: { ...products["5013957"], pack: { amount: 500, unit: "g" } },
  };
  assert.match(
    approvedPlanMismatch(text, changedProducts, approvedList),
    /product name or pack size changed/,
  );
  assert.match(
    buildReviewForInput(text, changedProducts, approvedList).planNotice,
    /product name or pack size changed/,
  );
  assert.equal(
    buildApprovedReview(
      text.replace("1 mela", "2 mela"),
      products,
      approvedList,
    ),
    null,
  );
});
