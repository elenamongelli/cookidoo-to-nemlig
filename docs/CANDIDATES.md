# Current List Decisions

Reconciled with the Nemlig invoice on 2026-10-23. The approved plan is in `approved-list.json` and applies only while the fingerprint of `shopping_list` and the selected products matches. It covers 44 ingredient lines: 32 products and 52 Nemlig units, with 3 lines excluded. The dry-run reports 0 missing.

## Excluded Lines (not bought)

| Line | Requirement          |
| ---- | -------------------- |
| 49   | 2.5 sprigs fresh dill |
| 51   | 2 fresh red chillies |
| 54   | 3 kaffir lime leaves |

## Key Substitutions

- Diced bacon replaces guanciale.
- Salad cheese cubes (5067098) replace the two Parmigiano lines and the hard-cheese line; weights are not equated.
- Fresh champignons replace the dried porcini and dried mushroom lines.
- Fresh coriander replaces coriander seeds and ground coriander.
- Skyr replaces Greek yoghurt. Specialbrød m. chiafrø covers "Glutenfri brød".
- Skin-on salmon portions are accepted for skinless fillets.
- Frozen blueberries (922765), washed potatoes (5059016) and the 0.85 l orange juice (5041946) were bought instead of the older SKUs; both SKUs are kept.
- One egg yolk counts as one egg (line 60 shares the egg purchase with line 59).

## Weights in products.json

Aubergine 300 g, courgette 350 g, cucumber 350 g (estimate), garlic head 50 g and clove 10 g, lemongrass 3 stalks per pack, red pepper 100 g, banana 100 g.

## Open

- Celery: stalks per bunch unknown; 100 g of stalk resolves only through the approved plan.
- Tests 7 (yogurt) and 24 (orange juice) fail because new SKUs share aliases with the old ones. Fix by dropping the shared aliases from the older SKUs, if the user agrees.
- Tests 44 and 45 are tied to the previous list.
- `products.json` has a stray `5053034` skyr entry nested inside the `5060611` broccoli entry; it does nothing.
- `REQUIREMENTS.md` still mentions the previous list's "60-product plan".
- Invoice rows not on the list and not saved: Pitabrød, Pink paradise zero, Æblecider, Druer Autumncrisp.

## After Ordering

Use the `nemlig-invoice-reconcile` skill in `.claude/skills/`. Preserve existing SKUs and add confirmed alternatives; do not save invoice prices or purchased quantities.
