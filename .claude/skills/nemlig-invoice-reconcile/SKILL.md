---
name: nemlig-invoice-reconcile
description: Reconcile a Nemlig invoice with the shopping list after ordering. Maps invoice SKUs to source lines, updates data/products.json, and rebuilds data/approved-list.json. Use when the user shares a Nemlig invoice/faktura, or says the dry-run shows missing items they have already bought.
---

# Nemlig invoice reconcile

Read `docs/REQUIREMENTS.md` first (workflow, data files). All data files below live in `data/`.

## Confirm the Shopping List First

Every time an invoice/faktura is added, shared, updated or replaced, ask: "Which shopping list (date and version) does this faktura belong to?" Wait for the user's confirmation before reconciling or changing product data or approval decisions. Ask even if there is only one saved list or the invoice was previously associated with a list; do not infer the answer from the latest file, current editor, receipt date or `data/shopping_list`.

Use the confirmed file in `data/shopping-lists/YYYY-MM-DD-vN.txt`, or another source explicitly identified by the user. If no saved version matches, ask for the actual list rather than guessing. Run `node dry-run.mjs <confirmed-list-path>` to inspect that list before making reconciliation changes. Preserve archived list text and the original `data/shopping_list`.

## Household Purchase Evidence

Retain shared invoice text in `data/fakturas/DD-MM-YYYY.txt`, using the verified purchase/delivery date, not today's date. Preserve SKU rows, original names, quantities and provenance; never overwrite a different receipt with the same filename. Ask if its date or identity is ambiguous. Existing text receipts are read locally by `household-supplies.mjs`; PDF interpretation remains assistant-assisted.

Tracked household rows can be unrelated to recipe lines: keep them in the raw receipt for stock reminders, without adding them to `data/shopping_list`, `data/approved-list.json` or `data/products.json`. A receipt is evidence of a purchase, not confirmation of current stock. After retaining a new receipt, run `node household-supplies.mjs --json` and relay due stock questions. Frequencies and buffers live in `data/household-supplies.json`; explicit user answers and completed offer checks live in `data/household-state.json`.

## Steps

1. Map every invoice row to source lines of the user-confirmed shopping list. A row with no matching line stays unmapped; do not save it. A list line with no invoice row is excluded for this list only; tell the user so they can confirm.
2. Ask before deciding any of these:
   - The invoice SKU differs from an existing preferred SKU for the same thing.
   - A weight, count or tsp/tbsp conversion is needed.
   - A row could cover more than one line.
3. Update `data/products.json`: add new SKUs with aliases in it/en/da/es. Keep old SKUs; never replace one without instruction. Never store prices, discounts, quantities or deposits.
4. With user review, rebuild `data/approved-list.json` for the confirmed list: purchases use invoice quantities, with source lines per SKU. If this would replace another list's active approval plan, first confirm that replacement with the user. Add a substitution note for every non-literal match, and an exclusion reason for every unbought line. Recompute both fingerprints from the confirmed list text and `data/products.json`, without rewriting the source list.
5. Verify: `node dry-run.mjs <confirmed-list-path>` shows 0 missing and the approved plan applied; `node --test test/*.test.mjs`. Run `prettier --write` on the JSON files.

## Gotchas

- The plan must account for every parsed line or it throws. Category headers must be in `CATEGORIES` in `lib/vocabulary.mjs`, or they parse as ingredients.
- Changing a selected product's name or pack invalidates `productsSha256`; rebuild the plan.
- A new SKU with the same aliases as an old one uses the first match under the user's offline selection rule (numeric SKU order). Adding a lower numeric SKU can therefore change the default. Preserve prior SKUs and explain any changed selection; fingerprinted approved decisions still take precedence for their exact list.
- `data/products.json` can express: grams per item, grams per ml, default unit and multiplier, and a count pack. It cannot express sprigs to plant, dried to fresh, or tsp/tbsp to grams; those live only in the approved plan.
- A count of "clove" for garlic is 10 g and a head is 50 g, so a bare "garlic" counts as one clove.
- Do not add generic units such as "stalks" to the vocabulary; it would make "3 stalks celery" buy 3 bunches. Use product-specific aliases.
- Tests 44 and 45 are tied to an older list; check which failures are new before reporting.
