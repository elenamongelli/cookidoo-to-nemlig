import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { comparePrices, formatComparison } from "./compare-prices.mjs";
import { PreferredProducts } from "./lib/preferred-products.mjs";
import { normalize } from "./lib/text-utils.mjs";

function dateValue(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`Invalid calendar date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error(`Invalid calendar date: ${value}`);
  return date;
}

function shiftDays(value, days) {
  const date = dateValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextDue(value, interval) {
  if (interval.unit === "days") return shiftDays(value, interval.amount);
  const date = dateValue(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + interval.amount);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function matches(item, sku, name) {
  const words = ` ${normalize(name)} `;
  return (
    item.skus.includes(sku) ||
    item.aliases.some((alias) => words.includes(` ${normalize(alias)} `))
  );
}

function validateConfig(config) {
  if (config.version !== 1 || !Array.isArray(config.items))
    throw new Error("Invalid household configuration.");
  const ids = new Set();
  for (const item of config.items) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(item.id) ||
      ids.has(item.id) ||
      !item.name ||
      !Array.isArray(item.skus) ||
      !Array.isArray(item.aliases) ||
      item.skus.some((sku) => typeof sku !== "string" || !/^\d+$/.test(sku)) ||
      item.aliases.some(
        (alias) => typeof alias !== "string" || !normalize(alias),
      ) ||
      !Number.isSafeInteger(item.bufferDays) ||
      item.bufferDays < 0 ||
      !Number.isSafeInteger(item.offerCheckEveryDays) ||
      item.offerCheckEveryDays < 1 ||
      (item.interval !== null &&
        (!item.interval ||
          !["days", "months"].includes(item.interval.unit) ||
          !Number.isSafeInteger(item.interval.amount) ||
          item.interval.amount < 1))
    )
      throw new Error(`Invalid household rule: ${item.id}`);
    ids.add(item.id);
  }
}

export function buildHouseholdReview(config, receipts, state, on) {
  validateConfig(config);
  dateValue(on);
  if (
    state.version !== 1 ||
    !Array.isArray(state.answers) ||
    !Array.isArray(state.offerChecks)
  )
    throw new Error("Invalid household state.");
  const purchases = [];
  const issues = [];
  for (const receipt of [...receipts].sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
  )) {
    const stamp = receipt.file.match(/^(\d{2})-(\d{2})-(\d{4})\.txt$/);
    if (!stamp) {
      issues.push({
        file: receipt.file,
        reason: "Receipt filename must be DD-MM-YYYY.txt.",
      });
      continue;
    }
    const purchasedOn = `${stamp[3]}-${stamp[2]}-${stamp[1]}`;
    try {
      dateValue(purchasedOn);
    } catch {
      issues.push({ file: receipt.file, reason: "Invalid receipt date." });
      continue;
    }
    if (purchasedOn > on) {
      issues.push({
        file: receipt.file,
        reason: "Future receipt ignored for this run.",
      });
      continue;
    }
    for (const [index, raw] of receipt.text.split(/\r?\n/).entries()) {
      const text = raw.trim();
      const identity = text.match(/^(\d{5,})\s+(.+)$/);
      if (!identity) continue;
      const matching = config.items.filter((item) =>
        matches(item, identity[1], identity[2]),
      );
      if (!matching.length) continue;
      const row = text.match(
        /^(\d{5,})\s+(.+?)\s+(?:\d+,\d{2}\s+){1,2}(\d+)\s+\d+,\d{2}$/,
      );
      if (
        !row ||
        !Number.isSafeInteger(Number(row[3])) ||
        Number(row[3]) < 1 ||
        matching.length !== 1
      ) {
        issues.push({
          file: receipt.file,
          line: index + 1,
          reason:
            "Tracked row is ambiguous or unsupported; purchase not inferred.",
        });
        continue;
      }
      purchases.push({
        id: matching[0].id,
        purchasedOn,
        file: receipt.file,
        line: index + 1,
        sku: row[1],
        name: row[2],
        packages: Number(row[3]),
      });
    }
  }
  const items = config.items.map((item) => {
    const history = purchases.filter((purchase) => purchase.id === item.id);
    const lastPurchasedOn =
      history
        .map((purchase) => purchase.purchasedOn)
        .sort()
        .at(-1) ?? null;
    const evidence = history.filter(
      (purchase) => purchase.purchasedOn === lastPurchasedOn,
    );
    const purchaseKey = createHash("sha256")
      .update(JSON.stringify(evidence))
      .digest("hex");
    const answers = state.answers.filter(
      (answer) =>
        answer.id === item.id &&
        answer.on <= on &&
        answer.purchaseKey === purchaseKey,
    );
    for (const answer of answers) {
      dateValue(answer.on);
      if (!["enough", "need"].includes(answer.answer))
        throw new Error(`Invalid stock answer: ${item.id}`);
      if (answer.answer === "enough") {
        dateValue(answer.until);
        if (answer.until <= answer.on)
          throw new Error(`Invalid stock recheck date: ${item.id}`);
      }
    }
    const answer = [...answers]
      .sort((left, right) =>
        left.on < right.on ? -1 : left.on > right.on ? 1 : 0,
      )
      .at(-1);
    const dueOn =
      answer?.answer === "enough"
        ? answer.until
        : answer?.answer === "need"
          ? answer.on
          : lastPurchasedOn && item.interval
            ? nextDue(lastPurchasedOn, item.interval)
            : null;
    const watchFrom = dueOn ? shiftDays(dueOn, -item.bufferDays) : null;
    const confirmedEnough = answer?.answer === "enough" && on < answer.until;
    const status = confirmedEnough
      ? "stock-confirmed"
      : answer?.answer === "need"
        ? "needs-stock"
        : !item.interval
          ? "configure-interval"
          : !lastPurchasedOn
            ? "unknown-stock"
            : on >= dueOn
              ? "due"
              : on >= watchFrom
                ? "watch-offers"
                : "not-yet";
    const checks = state.offerChecks.filter(
      (check) => check.id === item.id && check.on <= on,
    );
    for (const check of checks) dateValue(check.on);
    const lastOfferCheck =
      checks
        .map((check) => check.on)
        .sort()
        .at(-1) ?? null;
    const nextOfferCheckOn = lastOfferCheck
      ? shiftDays(lastOfferCheck, item.offerCheckEveryDays)
      : null;
    const checkOffers = Boolean(
      dueOn && on >= watchFrom && (!nextOfferCheckOn || on >= nextOfferCheckOn),
    );
    const question =
      confirmedEnough || status === "not-yet"
        ? null
        : `Do you have enough ${item.name}?${status === "configure-interval" ? " How often should you restock it?" : ""}`;
    return {
      id: item.id,
      name: item.name,
      status,
      question,
      lastPurchasedOn,
      evidence,
      purchaseKey,
      dueOn,
      watchFrom,
      checkOffers,
      lastOfferCheck,
      nextOfferCheckOn,
      interval: item.interval,
      bufferDays: item.bufferDays,
    };
  });
  return {
    on,
    mode: "offline-household-review",
    basketChanged: false,
    receiptCount: receipts.length,
    issues,
    items,
  };
}

export function prepareHouseholdOffers(report) {
  const preferred = new PreferredProducts({});
  return {
    version: 1,
    on: report.on,
    inputSha256: createHash("sha256")
      .update(JSON.stringify(report))
      .digest("hex"),
    checkedAt: null,
    deliveryContext: "Not selected; prices and availability are provisional.",
    groups: report.items
      .filter((item) => item.checkOffers)
      .map((item) => {
        const latest = item.evidence;
        const baseline = latest[0];
        const pack = baseline
          ? preferred.packSize({ name: baseline.name })
          : null;
        const samePack =
          baseline &&
          latest.every(
            (purchase) =>
              purchase.sku === baseline.sku && purchase.name === baseline.name,
          );
        const required =
          pack && samePack
            ? {
                amount:
                  latest.reduce(
                    (total, purchase) => total + purchase.packages,
                    0,
                  ) * pack.amount,
                unit: pack.unit,
              }
            : null;
        return {
          householdId: item.id,
          lines: latest.length ? latest.map((purchase) => purchase.line) : [],
          sources: [
            item.name,
            ...latest.map(
              (purchase) =>
                `${purchase.file}:${purchase.line} ${purchase.name}`,
            ),
          ],
          required,
          baselineSku: samePack ? baseline.sku : null,
          notes: [
            "Scenario based on the last receipt, not measured stock. Confirm quantity before buying.",
            ...(!required
              ? [
                  "Pack quantity is unresolved; do not infer a conversion or purchase amount.",
                ]
              : []),
          ],
          candidates:
            baseline && samePack
              ? [
                  {
                    sku: baseline.sku,
                    name: baseline.name,
                    url: null,
                    pack,
                    priceOre: null,
                    depositOre: 0,
                    available: null,
                    decision: "unreviewed",
                    conditions: "Confirm stock and purchase quantity first.",
                  },
                ]
              : [],
        };
      }),
    excluded: [],
  };
}

export function recordHouseholdAction(state, report, id, action, until) {
  const item = report.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`Unknown household item: ${id}`);
  const next = structuredClone(state);
  if (action === "offers-checked") {
    if (!item.checkOffers)
      throw new Error("No offer check is due for this item.");
    next.offerChecks.push({ id, on: report.on });
  } else {
    if (!["enough", "need"].includes(action))
      throw new Error("Unknown household action.");
    if (action === "enough") {
      dateValue(until);
      if (until <= report.on)
        throw new Error("Stock recheck date must be after the report date.");
    }
    next.answers.push({
      id,
      on: report.on,
      answer: action,
      purchaseKey: item.purchaseKey,
      ...(action === "enough" ? { until } : {}),
    });
  }
  return next;
}

export const householdStatusLabels = {
  "watch-offers": "Check stock and offers",
  "needs-stock": "Restock needed, based on your answer",
  "unknown-stock": "Stock not confirmed",
  "configure-interval": "Restock interval needed",
  "stock-confirmed": "Stock confirmed",
  "not-yet": "No action needed yet",
  due: "Stock check due",
};

export function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function readHouseholdInputs(
  directory = new URL("./data/", import.meta.url),
) {
  const config = JSON.parse(
    await readFile(new URL("household-supplies.json", directory), "utf8"),
  );
  let state;
  try {
    state = JSON.parse(
      await readFile(new URL("household-state.json", directory), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { version: 1, answers: [], offerChecks: [] };
  }
  const receiptDirectory = new URL("fakturas/", directory);
  const files = (await readdir(receiptDirectory))
    .filter((file) => file.endsWith(".txt"))
    .sort();
  const receipts = await Promise.all(
    files.map(async (file) => ({
      file,
      text: await readFile(new URL(file, receiptDirectory), "utf8"),
    })),
  );
  return { config, state, receipts };
}

export function formatHouseholdReview(report) {
  const dates = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const displayDate = (value) => dates.format(dateValue(value));
  const labels = householdStatusLabels;
  const questions = report.items.filter((item) => item.question);
  const offers = report.items.filter((item) => item.checkOffers);
  const output = [
    `HOUSEHOLD SUPPLIES | ${displayDate(report.on)}`,
    `Items: ${report.items.length} | Stock questions: ${questions.length} | Offer checks due: ${offers.length}`,
  ];
  const sections = [
    [
      "NEEDS ATTENTION",
      report.items.filter((item) => item.question || item.checkOffers),
    ],
    [
      "UNDER CONTROL",
      report.items.filter((item) => !item.question && !item.checkOffers),
    ],
  ];
  for (const [heading, items] of sections) {
    if (!items.length) continue;
    output.push("", heading);
    for (const item of items) {
      const title = item.name.charAt(0).toUpperCase() + item.name.slice(1);
      output.push("", `- ${title} - ${labels[item.status] ?? "Needs review"}`);
      if (item.question) output.push(`  ${item.question}`);
      output.push(
        item.lastPurchasedOn
          ? `  Last purchased: ${displayDate(item.lastPurchasedOn)}`
          : "  Last purchased: no receipt found",
      );
      if (item.dueOn)
        output.push(`  Stock recheck: ${displayDate(item.dueOn)}`);
      if (item.checkOffers)
        output.push("  Offers: check now (prices not yet verified)");
      else if (item.watchFrom) {
        const nextCheck =
          item.nextOfferCheckOn && item.nextOfferCheckOn > item.watchFrom
            ? item.nextOfferCheckOn
            : item.watchFrom;
        output.push(`  Next offer check: from ${displayDate(nextCheck)}`);
      }
    }
  }
  const evidence = report.items.flatMap((item) =>
    item.evidence.map(
      (purchase) =>
        `- ${item.name} (${item.id}): ${purchase.file}:${purchase.line} | ${purchase.packages} x ${purchase.name}`,
    ),
  );
  if (evidence.length) output.push("", "RECEIPT REFERENCES", ...evidence);
  if (report.issues.length)
    output.push(
      "",
      "WARNINGS",
      ...report.issues.map(
        (issue) =>
          `- ${issue.file}${issue.line ? `:${issue.line}` : ""}: ${issue.reason}`,
      ),
    );
  output.push(
    "",
    "Dates are estimates; confirm your remaining stock.",
    "Offline check only. No automatic purchases or shopping-list changes.",
  );
  return output.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "Usage: node household-supplies.mjs [--on YYYY-MM-DD] [--json] [--enough ID --until YYYY-MM-DD | --need ID | --offers-checked ID | --prepare-offers [--out new-snapshot.json] | --compare snapshot.json]";
  if (args.includes("--help")) {
    console.log(usage);
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (
      ![
        "--on",
        "--json",
        "--enough",
        "--until",
        "--need",
        "--offers-checked",
        "--prepare-offers",
        "--out",
        "--compare",
      ].includes(key) ||
      key in options
    )
      throw new Error(usage);
    if (["--json", "--prepare-offers"].includes(key)) options[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(usage);
      options[key] = value;
    }
  }
  const actions = ["--enough", "--need", "--offers-checked"].filter(
    (key) => options[key],
  );
  if (
    actions.length +
      Number(Boolean(options["--prepare-offers"])) +
      Number(Boolean(options["--compare"])) >
      1 ||
    Boolean(options["--until"]) !== Boolean(options["--enough"]) ||
    (options["--out"] && !options["--prepare-offers"])
  )
    throw new Error(usage);
  const snapshot = options["--compare"]
    ? JSON.parse(await readFile(options["--compare"], "utf8"))
    : null;
  const on = options["--on"] ?? snapshot?.on ?? localDate(new Date());
  let { config, state, receipts } = await readHouseholdInputs();
  const statePath = new URL("./data/household-state.json", import.meta.url);
  let report = buildHouseholdReview(config, receipts, state, on);
  if (options["--prepare-offers"]) {
    const prepared = prepareHouseholdOffers(report);
    if (options["--out"]) {
      await writeFile(options["--out"], `${JSON.stringify(prepared)}\n`, {
        flag: "wx",
      });
      console.log(
        `Created ${options["--out"]}; ${prepared.groups.length} household offer checks. No live prices collected.`,
      );
    } else console.log(JSON.stringify(prepared));
    return;
  }
  if (snapshot) {
    const comparison = comparePrices(snapshot, prepareHouseholdOffers(report));
    console.log(
      options["--json"]
        ? JSON.stringify(comparison)
        : formatComparison(comparison),
    );
    return;
  }
  if (actions.length) {
    const action = actions[0];
    state = recordHouseholdAction(
      state,
      report,
      options[action],
      action.slice(2),
      options["--until"],
    );
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    report = buildHouseholdReview(config, receipts, state, on);
  }
  console.log(
    options["--json"] ? JSON.stringify(report) : formatHouseholdReview(report),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`Household check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
