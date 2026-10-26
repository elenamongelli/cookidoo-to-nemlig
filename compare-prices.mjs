import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildReviewForInput } from "./lib/approved-list.mjs";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function prepareComparison(text, products, decisions) {
  const review = buildReviewForInput(text, products, decisions);
  const groups = [
    ...review.items.map((item) => ({
      lines: item.requirements.map((requirement) => requirement.line),
      sources: item.requirements.map((requirement) => requirement.original),
      required: item.required ?? {
        amount: item.packages * item.pack.amount,
        unit: item.pack.unit,
      },
      baselineSku: item.sku,
      notes: item.required
        ? item.substitutions
        : [
            ...item.substitutions,
            `Coverage target is the approved supply of ${item.packages} x ${item.pack.amount} ${item.pack.unit}, not a new ingredient conversion. Excess is measured against that target.`,
          ],
      candidates: [
        {
          sku: item.sku,
          name: item.name,
          url: null,
          pack: item.pack,
          priceOre: null,
          depositOre: 0,
          available: null,
          decision: "unreviewed",
          conditions: "",
        },
      ],
    })),
    ...review.unresolved.map((requirement) => ({
      lines: [requirement.line],
      sources: [requirement.original],
      required: ["g", "ml", "count"].includes(requirement.unit)
        ? { amount: requirement.amount, unit: requirement.unit }
        : null,
      baselineSku: null,
      notes: [requirement.reason],
      candidates: [],
    })),
  ].sort((left, right) => left.lines[0] - right.lines[0]);
  return {
    version: 1,
    inputSha256: hash([text, products, decisions]),
    checkedAt: null,
    deliveryContext: "Not selected; prices and availability are provisional.",
    groups,
    excluded: review.excluded.map(({ line, original, reason }) => ({
      line,
      original,
      reason,
    })),
  };
}

function isMoney(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function quote(candidate, required) {
  if (candidate.decision !== "suitable" || candidate.available !== true)
    return { reason: "Suitability or availability not confirmed." };
  let url;
  try {
    url = new URL(candidate.url);
  } catch {
    return { reason: "Missing verified product URL." };
  }
  if (
    url.protocol !== "https:" ||
    !["www.nemlig.com", "nemlig.com"].includes(url.hostname) ||
    typeof candidate.sku !== "string" ||
    !/^\d+$/.test(candidate.sku) ||
    !url.pathname.endsWith(`-${candidate.sku}`) ||
    url.search ||
    url.hash ||
    !candidate.name
  )
    return { reason: "Invalid product identity or direct URL." };
  if (
    !required ||
    !(required.amount > 0) ||
    !Number.isFinite(required.amount) ||
    !candidate.pack ||
    candidate.pack.unit !== required.unit ||
    !(candidate.pack.amount > 0) ||
    !Number.isFinite(candidate.pack.amount)
  )
    return { reason: "Quantity or compatible pack size unresolved." };
  if (!isMoney(candidate.priceOre) || !isMoney(candidate.depositOre ?? 0))
    return { reason: "Missing or invalid price in integer ore." };
  const minimum = Math.ceil(required.amount / candidate.pack.amount);
  if (!Number.isSafeInteger(minimum))
    return { reason: "Package count is out of range." };
  const offer = candidate.multibuy;
  if (
    offer &&
    (!Number.isSafeInteger(offer.packs) ||
      offer.packs < 2 ||
      !isMoney(offer.priceOre) ||
      offer.sameSku !== true)
  )
    return {
      reason:
        "Multibuy must have verified same-SKU eligibility and integer prices.",
    };
  const quantities = offer
    ? [...new Set([minimum, Math.ceil(minimum / offer.packs) * offer.packs])]
    : [minimum];
  const quotes = quantities.map((packages) => {
    const regular = packages * candidate.priceOre;
    const productCostOre = offer
      ? Math.min(
          regular,
          Math.floor(packages / offer.packs) * offer.priceOre +
            (packages % offer.packs) * candidate.priceOre,
        )
      : regular;
    const depositCostOre = packages * (candidate.depositOre ?? 0);
    return {
      sku: candidate.sku,
      name: candidate.name,
      url: candidate.url,
      pack: candidate.pack,
      packages,
      supplied: packages * candidate.pack.amount,
      excess: packages * candidate.pack.amount - required.amount,
      productCostOre,
      depositCostOre,
      totalCostOre: productCostOre + depositCostOre,
      conditions: candidate.conditions ?? "",
    };
  });
  if (
    quotes.some(
      (result) =>
        !Number.isSafeInteger(result.totalCostOre) ||
        !Number.isFinite(result.supplied),
    )
  )
    return { reason: "Calculated cost or quantity is out of range." };
  return quotes.sort(rank)[0];
}

function rank(left, right) {
  return (
    left.totalCostOre - right.totalCostOre ||
    left.excess - right.excess ||
    (left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0)
  );
}

export function comparePrices(snapshot, prepared) {
  if (snapshot.version !== 1 || snapshot.inputSha256 !== prepared.inputSha256)
    throw new Error(
      "Snapshot does not match the current list and saved decisions; prepare a new snapshot.",
    );
  if (
    !snapshot.checkedAt ||
    !Number.isFinite(Date.parse(snapshot.checkedAt)) ||
    typeof snapshot.deliveryContext !== "string" ||
    !snapshot.deliveryContext.trim()
  )
    throw new Error(
      "Set checkedAt and deliveryContext from the catalogue review.",
    );
  const identity = (groups) => groups.map(({ candidates, ...group }) => group);
  if (
    JSON.stringify(identity(snapshot.groups)) !==
      JSON.stringify(identity(prepared.groups)) ||
    JSON.stringify(snapshot.excluded) !== JSON.stringify(prepared.excluded)
  )
    throw new Error(
      "Snapshot requirements changed; edit only candidates and observation metadata.",
    );
  const items = snapshot.groups.map((group) => {
    if (
      !Array.isArray(group.candidates) ||
      group.candidates.length > 11 ||
      new Set(group.candidates.map((candidate) => candidate.sku)).size !==
        group.candidates.length
    )
      throw new Error(
        `Invalid or duplicate candidates for source lines ${group.lines.join(", ")}.`,
      );
    const alternatives = [];
    const pending = [];
    for (const candidate of group.candidates) {
      const result = quote(candidate, group.required);
      if (result.reason)
        pending.push({
          sku: candidate.sku,
          decision: candidate.decision,
          reason: result.reason,
        });
      else alternatives.push(result);
    }
    alternatives.sort(rank);
    pending.sort((left, right) =>
      String(left.sku).localeCompare(String(right.sku), "en"),
    );
    const recommendation = alternatives[0] ?? null;
    const baseline = alternatives.find(
      (candidate) => candidate.sku === group.baselineSku,
    );
    return {
      lines: group.lines,
      sources: group.sources,
      required: group.required,
      notes: group.notes,
      status: recommendation ? "recommendation" : "unresolved",
      recommendation,
      baseline: baseline ?? null,
      savingOre:
        baseline && recommendation
          ? baseline.totalCostOre - recommendation.totalCostOre
          : null,
      alternatives,
      pending,
    };
  });
  return {
    mode: "offline-price-comparison",
    basketChanged: false,
    checkedAt: snapshot.checkedAt,
    deliveryContext: snapshot.deliveryContext,
    inputSha256: snapshot.inputSha256,
    snapshotSha256: hash(snapshot),
    items,
    excluded: snapshot.excluded,
  };
}

function money(amount) {
  return `${(amount / 100).toFixed(2)} DKK`;
}
function cell(value) {
  return String(value)
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]/g, " ");
}

export function formatComparison(report) {
  const output = [
    `Snapshot: ${report.checkedAt}. ${report.deliveryContext}`,
    "Compared supplied candidates only; snapshot prices are not rechecked live.",
    "",
    "| Source lines / ingredient | Product | Buy | Supplied / excess | Cost incl. deposit | Saved-SKU baseline / saving | Conditions |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const item of report.items) {
    const product = item.recommendation;
    const source = `${item.lines.join(", ")}: ${item.sources.join("; ")}`;
    if (!product) {
      output.push(
        `| ${cell(source)} | Unresolved | - | - | - | - | ${cell([...item.notes, ...item.pending.map((candidate) => candidate.reason)].join("; "))} |`,
      );
      continue;
    }
    const baseline = item.baseline
      ? `${item.baseline.name}: ${money(item.baseline.totalCostOre)} / ${money(item.savingOre)}`
      : "Not verified";
    const productName = cell(product.name).replace(/[\[\]]/g, "");
    output.push(
      `| ${cell(source)} | [${productName}](${encodeURI(product.url)}) | ${product.packages} x ${product.pack.amount} ${product.pack.unit} | ${product.supplied} / ${product.excess} ${product.pack.unit} | ${money(product.totalCostOre)} (deposit ${money(product.depositCostOre)}) | ${cell(baseline)} | ${cell([...item.notes, product.conditions, ...item.pending.map((candidate) => `${candidate.sku}: ${candidate.decision}`)].filter(Boolean).join("; "))} |`,
    );
  }
  if (report.excluded.length)
    output.push(
      "",
      "Excluded:",
      ...report.excluded.map(
        (item) => `- ${item.line}: ${item.original} - ${item.reason}`,
      ),
    );
  output.push(
    "",
    "No basket or saved choices changed. No complete basket total claimed.",
  );
  return output.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "Usage: node compare-prices.mjs --prepare [shopping-list-path] [--out new-snapshot.json] OR node compare-prices.mjs snapshot.json [shopping-list-path] [--json]";
  if (args.includes("--help")) {
    console.log(usage);
    return;
  }
  let outputPath;
  const outputIndex = args.indexOf("--out");
  if (outputIndex !== -1) {
    outputPath = args[outputIndex + 1];
    if (
      !outputPath ||
      outputPath.startsWith("-") ||
      !args.includes("--prepare")
    )
      throw new Error(usage);
    args.splice(outputIndex, 2);
  }
  if (
    args.some(
      (argument) =>
        argument.startsWith("-") && !["--prepare", "--json"].includes(argument),
    )
  )
    throw new Error(usage);
  const paths = args.filter((argument) => !argument.startsWith("-"));
  const prepare = args.includes("--prepare");
  if (
    (prepare && paths.length > 1) ||
    (!prepare && (paths.length < 1 || paths.length > 2))
  )
    throw new Error(usage);
  const [text, dictionary, decisions] = await Promise.all([
    readFile(
      paths[prepare ? 0 : 1] ??
        new URL("./data/shopping_list", import.meta.url),
      "utf8",
    ),
    readFile(new URL("./data/products.json", import.meta.url), "utf8"),
    readFile(new URL("./data/approved-list.json", import.meta.url), "utf8"),
  ]);
  const prepared = prepareComparison(
    text,
    JSON.parse(dictionary),
    JSON.parse(decisions),
  );
  if (prepare) {
    if (outputPath) {
      await writeFile(outputPath, `${JSON.stringify(prepared)}\n`, {
        flag: "wx",
      });
      console.log(
        `Created ${outputPath}; populate verified candidates before comparison.`,
      );
    } else console.log(JSON.stringify(prepared));
    return;
  }
  const snapshot = JSON.parse(await readFile(paths[0], "utf8"));
  const report = comparePrices(snapshot, prepared);
  console.log(
    args.includes("--json") ? JSON.stringify(report) : formatComparison(report),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Price comparison failed: ${error.message}`);
    process.exitCode = 1;
  });
}
