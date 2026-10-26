import { normalize } from "./text-utils.mjs";

const EXCLUSIONS = [
  {
    aliases: [
      "food coloring",
      "food color",
      "food colour",
      "food colouring",
      "yellow coloring",
      "yellow colouring",
      "colorante giallo",
      "colorante amarillo",
      "colorante alimentare",
      "colorante alimentario",
      "colorante alimenticio",
      "madfarve",
    ],
    reason: "Standing exclusion: food colouring.",
  },
  {
    aliases: [
      "dried onion",
      "dried onions",
      "tørret løg",
      "tørrede løg",
      "cipolla disidratata",
      "cipolle disidratate",
      "cipolla essiccata",
      "cipolle essiccate",
      "cebolla deshidratada",
      "cebollas deshidratadas",
      "cebolla seca",
      "cebollas secas",
    ],
    reason: "Standing exclusion: dried onions.",
  },
  {
    aliases: [
      "fresh mixed herbs",
      "mixed fresh herbs",
      "fresh herb mix",
      "erbe miste fresche",
      "erbe aromatiche miste fresche",
      "friske blandede urter",
      "hierbas frescas mixtas",
      "mezcla de hierbas frescas",
    ],
    reason: "Standing exclusion: fresh mixed herbs.",
  },
];

export function findStandingExclusion(ingredient) {
  const normalizedIngredient = ` ${normalize(ingredient)} `;
  return EXCLUSIONS.find(({ aliases }) =>
    aliases.some((alias) =>
      normalizedIngredient.includes(` ${normalize(alias)} `),
    ),
  );
}
