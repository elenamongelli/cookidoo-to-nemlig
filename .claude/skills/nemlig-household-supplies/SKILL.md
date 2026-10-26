---
name: nemlig-household-supplies
description: "Maintains receipt-backed household supply reminders and their product configuration. Use when the user wants to add a household product, update a tracked item, change restock intervals or offer buffers, configure Scottex or kitchen roll, or record stock answers."
---

# Nemlig Household Supplies

## Scope

Maintain the existing household workflow; do not build a second reminder system. Run commands from the repository root. Keep responses, display names and stock questions in English; preserve original receipt wording and multilingual aliases.

Read `docs/REQUIREMENTS.md`, `data/household-supplies.json` and the relevant configuration validation in `household-supplies.mjs` before editing. Read `data/household-state.json` if present only when needed to understand an existing item's answers; never reset it as part of a configuration edit.

## Add or Update a Product

1. Identify the existing tracked category by ID, name, SKU and aliases before adding anything. A new brand or pack of the same supply usually belongs to that existing category, not a duplicate reminder. If the user's intended category or change is ambiguous, ask one focused question.
2. Gather only missing facts: English display name, restock interval, early-offer buffer and check frequency. Verify SKUs and receipt names from `data/fakturas/DD-MM-YYYY.txt` or user-supplied evidence. Do not browse unless authorized; do not invent a SKU, purchase date or current stock.
3. Edit only the requested entry in `data/household-supplies.json`, preserving all other entries and existing SKUs/aliases. For a new entry, use a unique stable lowercase hyphenated `id`, an English `name`, `skus` and `aliases` arrays, `interval`, `bufferDays` and `offerCheckEveryDays`. Keep top-level `version: 1`.
4. SKU values are numeric strings. Use an empty SKU array if none is verified, with specific evidence-backed aliases when available. Explain that no verified SKU/alias means receipt discovery is not ready. Do not invent transliterations or use broad aliases such as `soap` that could match unrelated supplies.
5. Intervals are either `null` (not yet configured) or an object with positive integer `amount` and `unit` of `days` or `months`. Convert explicitly requested weeks to days; keep calendar months as months, not an assumed 30/60-day duration. Month-end scheduling clamps to the last valid day.
6. `bufferDays` is a nonnegative integer; `offerCheckEveryDays` is a positive integer. Preserve existing values on updates. For new entries, propose the existing 7-day buffer and 7-day check spacing if unspecified and get agreement before treating them as chosen. Do not invent a restock interval; leave it `null` when the user wants to configure it later.
7. Preserve the existing ID so saved answers stay attached. Do not rename, delete or merge IDs without explicit direction and consideration of their saved state. Do not infer faster/slower consumption from purchased pack counts or multiply intervals by receipt quantities.
8. Check for SKU reuse and overlapping normalized aliases across categories; if a receipt row could match multiple items, resolve the ambiguity with the user. Do not silently assign it to one category. Preserve actual invoice names, quantities and source references.

## Validate and Report

- After a configuration edit, run `node household-supplies.mjs --json` first. It validates configuration and reads receipt evidence without changing state. Inspect `issues`, the changed item's last purchase, due date, offer window and questions. Unknown stock or an unconfigured interval is a valid visible outcome, not something to fill with guesses.
- Run `node household-supplies.mjs` to inspect the readable English report. Use `--on YYYY-MM-DD` when checking a particular receipt/date boundary or reproducing a result.
- Do not change runtime code or tests for routine product updates. Do not run the full test suite for every configuration edit; existing tests contain assumptions about current entries. If behavior changes are explicitly requested, add focused regression coverage and follow the repository's behavior-change verification requirements.
- Summarize only the changed product, its interval, early buffer and check spacing, plus any missing evidence or configuration. Explain that changed rules can invalidate prepared household offer snapshots; prepare a fresh snapshot rather than editing its fingerprint.

## Record Stock Answers

- Only after the user explicitly confirms stock, use `node household-supplies.mjs --enough ID --until YYYY-MM-DD` or `node household-supplies.mjs --need ID`. For an enough answer, ask for a future recheck date if missing; do not assume an indefinite supply.
- These commands write `data/household-state.json`. Enough answers defer questions and move the early-offer window; new purchase evidence invalidates prior answers. A purchase is not proof of remaining stock, and missing receipts do not prove an item was never bought elsewhere.
- Use `--offers-checked ID` only after an actual completed live price check, never after preparing a snapshot or failed browsing. Repeated checks are gated by the configured spacing.

## Related Workflows and Limits

- For authorized live offers, follow the `nemlig-price-compare` skill and its household snapshot commands. Keep household scenarios separate from recipe requirements and confirm purchase quantity before adding anything.
- For receipt retention or invoice interpretation, follow `nemlig-invoice-reconcile`. Never rewrite receipts to manufacture a match.
- Do not edit `data/shopping_list`, `data/products.json` or `data/approved-list.json` for reminder configuration. Do not store receipt prices in the product dictionary or add products to a basket.
- This is an on-demand offline check, not a background scheduler or notification service. Do not promise weekly execution while it is closed.

## Example Requests

- "Add dishwasher tablets every two months, with a two-week offer buffer and weekly checks."
- "Change kitchen roll to every three weeks; keep its current buffer."
- "I have enough toilet paper; remind me again on [date]."
