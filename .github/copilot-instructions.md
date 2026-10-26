# Project Context

This repository turns multilingual Cookidoo shopping lists into a reviewable Nemlig import link. Read [docs/REQUIREMENTS.md](../docs/REQUIREMENTS.md) for the intended workflow, selection rules, and known limitations before changing behavior. Data lives in `data/`, engine modules in `lib/`, tests in `test/`; the CLIs and `server.mjs` stay at the top level.

## Domain Guardrails

- This is an offline dry-run tool. Do not add network requests, live catalogue or price checks, or automatic basket operations without explicit direction.
- The generated link contains resolved products only. Missing or ambiguous requirements must stay visible; never silently treat them as purchased or excluded.
- Preserve original ingredient wording and source line numbers. Do not invent quantity, weight, volume, count, or form conversions; use only explicit configured rules and approved decisions.
- If a suitable product is identified but its required quantity is uncertain, give the user its verified direct Nemlig product link under "Add manually - quantity uncertain", preserving the source requirement and briefly explaining the uncertainty. Let the user choose the quantity and add it to the cart; do not block the rest of the review on quantity clarification, guess a pack count, include it in the import link or claim it is covered. Keep unavailable/unidentified products and unapproved substitutions distinct from this fallback. Never invent a product URL from a name or SKU.
- Product identity is the Nemlig SKU. Preserve existing SKUs and aliases unless the user asks to change them. Do not store invoice prices, discounts, purchased quantities, or deposits in `data/products.json`.
- `data/approved-list.json` is specific to the fingerprinted current shopping list and selected product data. Do not update its decisions or fingerprints without user review.
- Treat `data/shopping_list` as user input. Avoid changing it unless asked.
- Whenever an invoice/faktura is added, shared, updated or replaced, always ask which shopping list (date and version) it belongs to and wait for confirmation before reconciliation or product/approval changes. Never assume the latest saved list, current editor, receipt date or `data/shopping_list`; use the user-confirmed source without rewriting it.
- During assistant-assisted shopping-list reviews, first run `node household-supplies.mjs --json` and ask its stock questions separately from recipe requirements. Use its `checkOffers` flags to route explicitly authorized live checks through the price-comparison skill. Do not assume that a receipt proves remaining stock or add household items to the list without approval.

## Code and Verification

- Keep changes small and follow the existing JavaScript ES module style. No package installation is needed for the current CLI or tests.
- Run the focused test command `node --test test/*.test.mjs` after behavior changes. Run `node dry-run.mjs data/shopping_list` to inspect the readable offline report; use `--json` for structured output.
- Do not change CLI output or exported `parseList` and `buildReview` APIs without a clear requirement.
- For invoice reconciliation, follow [.claude/skills/nemlig-invoice-reconcile/SKILL.md](../.claude/skills/nemlig-invoice-reconcile/SKILL.md); ask about ambiguous invoice rows and retain prior preferred SKUs.
