import { readFile } from "node:fs/promises";
import { buildReviewForInput } from "./lib/approved-list.mjs";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node dry-run.mjs [shopping-list-path] [--json]");
    console.log("Offline review only. No network requests or basket changes.");
    return;
  }
  const unknown = args.find(
    (argument) => argument.startsWith("-") && argument !== "--json",
  );
  const paths = args.filter((argument) => !argument.startsWith("-"));
  if (unknown || paths.length > 1)
    throw new Error("Usage: node dry-run.mjs [shopping-list-path] [--json]");
  const input = paths[0] ?? new URL("./data/shopping_list", import.meta.url);
  const [text, dictionary, decisions] = await Promise.all([
    readFile(input, "utf8"),
    readFile(new URL("./data/products.json", import.meta.url), "utf8"),
    readFile(new URL("./data/approved-list.json", import.meta.url), "utf8"),
  ]);
  const preferredProducts = JSON.parse(dictionary);
  const approvalPlan = JSON.parse(decisions);
  const review = buildReviewForInput(text, preferredProducts, approvalPlan);
  if (args.includes("--json")) {
    console.log(JSON.stringify(review, null, 2));
    return;
  }
  printReview(review);
}

function printReview(review) {
  const matchedCount = review.items.reduce(
    (total, item) => total + item.requirements.length,
    0,
  );
  const packageCount = review.items.reduce(
    (total, item) => total + item.packages,
    0,
  );
  console.log("OFFLINE REVIEW - no network or basket changes.");
  if (review.planNotice) console.log(`${review.planNotice}\n`);
  console.log(
    `${review.requirementCount} lines | ${review.items.length} products | ${packageCount} units | ${review.excluded.length} excluded | ${review.unresolved.length} missing`,
  );

  if (review.items.length) console.log("\nProducts to include:");
  for (const [index, item] of review.items.entries()) {
    const supplied = item.packages * item.pack.amount;
    console.log(`${index + 1}. ${item.name} - buy ${item.packages}`);
    const amountText = item.purchaseOverride
      ? `Supplies ${formatAmount(supplied)} ${item.pack.unit} (approved quantity)`
      : `Required ${formatAmount(item.required.amount)} ${item.required.unit}; supplies ${formatAmount(supplied)} ${item.pack.unit}`;
    console.log(`   ${amountText}${item.estimated ? " [estimated]" : ""}`);
    for (const requirement of item.requirements)
      console.log(
        `   Source line ${requirement.line}: ${requirement.original}`,
      );
    for (const substitution of item.substitutions)
      console.log(`   Note: ${substitution}`);
  }
  if (review.excluded.length) {
    console.log("\nExcluded:");
    for (const requirement of review.excluded)
      console.log(
        `- Line ${requirement.line}: ${requirement.original} - ${requirement.reason}`,
      );
  }
  if (review.unresolved.length) {
    console.log("\nMissing (not in the link):");
    for (const requirement of review.unresolved) {
      console.log(`- Line ${requirement.line}: ${requirement.original}`);
      console.log(`  Reason: ${requirement.reason}`);
    }
  }
  if (review.importUrl) {
    console.log("\nImport link (resolved products only; not opened):");
    console.log(review.importUrl);
  }
  console.log(
    "\nPrices and availability are unchecked; review the basket manually.",
  );
}

function formatAmount(amount) {
  return Number.isInteger(amount)
    ? String(amount)
    : String(Number(amount.toFixed(2)));
}

main().catch((error) => {
  console.error(`Dry run failed: ${error.message}`);
  process.exitCode = 1;
});
