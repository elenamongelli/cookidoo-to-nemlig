export function createImportUrl(items) {
  const selections = items
    .filter(
      (item) =>
        typeof item.sku === "string" &&
        Number.isSafeInteger(item.packages) &&
        item.packages > 0,
    )
    .map((item) => `${item.sku}-${item.packages}`);
  return selections.length
    ? `https://www.nemlig.com/basket?topup=email&skus=${selections.join(",")}`
    : null;
}
