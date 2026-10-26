# Cookidoo to Nemlig

Updated 2026-10-17. This document describes the intended workflow and what the local code currently does.

## Workflow

1. The user sends a multilingual shopping list.
2. The assistant returns a Nemlig link for selected products, a product/source-line report, and a separate list of missing or excluded requirements. Missing items are never silently treated as purchased.
3. The user reviews the basket and completes the order manually.
4. The user shares the invoice. The assistant maps purchased SKUs back to the proposal and source requirements, then infers preferred products when the evidence is clear. Ask about ambiguous rows. Keep prior preferred SKUs; add a new SKU rather than replacing one without instruction.

Do not save receipt prices, discounts, purchased quantities, or deposits in `products.json`. The user performs checkout; the code does not operate the basket.

## Implemented

- Run `node server.mjs` for the local review website at `http://127.0.0.1:3000`. It starts with a blank editor and saves each reviewed input unchanged in `data/shopping-lists/YYYY-MM-DD-vN.txt` using the server's local date and a non-overwriting daily version. Emptying the editor does not delete history. It reuses the dry-run engine, with searchable product/source details, separate missing/excluded views and a confirmed Nemlig handoff. `HOST`, `PORT`, `PUBLIC_ORIGIN` and `ACCESS_KEY` (optional one-year device login) are configurable for Linux hosting; see [README.md](../README.md). No dependencies or build step are needed. It does not change the original shopping list, add live checks, save decisions or operate the basket.
- Run `node dry-run.mjs [shopping-list-path]` for a readable report, or add `--json`. Tests: `node --test test/*.test.mjs`.
- Parse Italian, English, Danish, and Spanish quantities while retaining source line numbers and unchanged wording.
- Match saved SKU-keyed products. An index of Danish aliases handles exact Danish names; multilingual alias matching remains the fallback.
- Apply configured form rules and explicit conversions, aggregate compatible requirements before rounding to whole product units, and retain contributing source lines.
- Generate a Nemlig import link for resolved products only. Unresolved items appear as missing; exclusions are reported separately. Prices and availability are not checked.
- `approved-list.json` applies the approved 60-product plan only when both the shopping-list text and selected product names/pack data match their fingerprints. A mismatch is reported before generic matching is used.
- Standing exclusions for food colouring, dried onions, and fresh mixed herbs apply to future lists. The current-list-only skips are recorded in `approved-list.json`.
- Assistant-assisted price comparisons use `node compare-prices.mjs --prepare data/shopping_list --out price-snapshot.json`, then `node compare-prices.mjs price-snapshot.json data/shopping_list` (or `--json`) after verified browser observations populate the snapshot. The offline script prints product links, whole-pack quantities, excess, deposits and saved-SKU savings. It ranks suitable available candidates by coverage cost, excess and SKU, without changing saved choices. Snapshots are bound to the list, products and approval data; retained snapshots are historical, not live quotes. See `.claude/skills/nemlig-price-compare/SKILL.md` for the observation format and limits.

The link is a user action: opening it can change the Nemlig basket. The program itself makes no network or basket requests, and `importReady` remains false because live price and availability checks are absent.

## Selection Rules

- Keep product identity by SKU; product names and multilingual aliases are lookup/display data.
- When multiple saved products match equally, use the first candidate in the existing product iteration order (numeric SKU keys are visited in ascending order). Exact Danish aliases and longest multilingual alias matching keep their existing precedence. The selected product must still pass qualifier, form, pack and conversion checks; unsupported requirements remain missing. This is a user-approved offline default, not a price or availability comparison, and does not change fingerprinted approved decisions.
- Preserve original ingredients and qualifiers. Do not invent weight, volume, count, or form conversions. Unknown or unsupported requirements remain missing unless a confirmed exclusion applies.
- Respect the explicit saved substitutions and form exceptions in `products.json`. Combine compatible amounts before package rounding.
- Future catalogue discovery is intended to inspect at most the first ten results, reject unsuitable products before price ranking, and require user approval. Compare fresh products by total cost to cover the requirement; use normalized unit price for configured long-life products, subject to the approved excess cap. A REMA price-match badge is a positive signal, not proof of lowest cost.

## Household Replenishment

- Run `node household-supplies.mjs` (or `--json`) during assistant-assisted shopping reviews. `--on YYYY-MM-DD` fixes the evaluation date for repeatable results. It scans SKU rows in `data/fakturas/DD-MM-YYYY.txt`, preserving receipt/line evidence and purchased pack counts without copying prices into the product dictionary. Future, malformed or ambiguous tracked rows are reported rather than guessed.
- `data/household-supplies.json` defines categories, SKU/name matches, replenishment intervals, early-offer buffers and check frequency. Initial rules: toilet paper every 14 days with a 7-day buffer; dish soap every 2 calendar months with an initial configurable 7-day buffer. Kitchen roll has no assumed interval. Offer-check spacing defaults to 7 days. Calendar-month additions clamp to the month's last valid day.
- Due dates are estimates from the latest observed purchase, not assertions about remaining stock. Multiple purchased packs do not silently multiply the interval. Missing evidence prompts a stock question; missing intervals prompt configuration. Other-store purchases or differing consumption require user confirmation, not invented stock counts.
- An explicit answer can be recorded with `node household-supplies.mjs --enough toilet-paper --until 2026-11-10` (recheck on that date), or `--need toilet-paper`. `data/household-state.json` is created only when recording an answer or completed offer check. Stock confirmations postpone questions and move the early-offer window; new receipt evidence invalidates prior stock answers.
- `node household-supplies.mjs --prepare-offers --out household-offers-DATE.json` prepares only eligible offer checks. After assistant-verified candidate observations, `node household-supplies.mjs --compare household-offers-DATE.json` prints the existing price-comparison report with links, pack counts and cost/savings. The target is explicitly the last receipt's purchased quantity as a scenario, not an approved replenishment amount. Unknown packs remain unresolved. The user confirms stock, quantity and substitutions before any shopping-list change.
- Record `node household-supplies.mjs --offers-checked toilet-paper` only after completing an actual price check. This suppresses repeated checks until the configured interval passes. Preparation and failed browsing do not count. Recording state changes invalidates earlier comparison fingerprints; retain the rendered report with its snapshot before recording completion.
- The tool makes no network requests, runs no background scheduler and sends no notifications while closed. Eligible checks are surfaced when invoked; live offers still require explicitly authorized assistant browsing. Recipe-list parsing, approved decisions and existing CLI output are unchanged.
- The website shows a read-only household summary (`GET /api/household`) built from the same engine and server-side receipts. It sends display fields only, never receipt rows or filenames, and cannot record answers or offer checks.

## Not Implemented

- Live Nemlig catalogue search, saved-SKU price/availability lookup, category-based price selection, or badge detection. The documented API flow and delivery-context behavior are not reliable enough to automate yet.
- Interactive clarification or new-product approval. Missing products are reported, not discovered automatically.
- Invoice parsing in the CLI. Invoice interpretation and dictionary maintenance are assistant-assisted follow-up work.
- iPhone runtime or verified handoff to Chrome. The user opens the generated link and checks the basket manually.

## Data

All data lives in `data/`; engine modules are in `lib/`, tests in `test/`, and the CLIs and `server.mjs` at the top level.

- `data/products.json`: preferred SKUs, aliases, pack details, explicit estimates, and standing product rules.
- `data/approved-list.json`: fingerprinted current-list package decisions, substitutions, source-line mapping, and exclusions.
- `data/shopping_list`: original input (the CLI default). `data/shopping-lists/`: saved website reviews. `data/fakturas/`: invoices. `data/household-supplies.json` and `data/household-state.json`: reminder config and answers.
- `docs/CANDIDATES.md`: concise decision summary.
