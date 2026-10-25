import { ID_PATTERN, type Look } from "./look.js";

/**
 * The text of looks.json for a list of looks: one look on each line, in the order id, name, priceUsd, change, as the game starter's
 * file is written, so a change of one look is a change of one line in a diff. It ends with a new line.
 */
export function looksJson(looks: readonly Look[]): string {
  const row = (l: Look) => {
    const change = [`"body": ${JSON.stringify(l.change.body)}`];
    if (l.change.hat !== undefined) change.push(`"hat": ${JSON.stringify(l.change.hat)}`);
    if (l.change.hatColor !== undefined) change.push(`"hatColor": ${JSON.stringify(l.change.hatColor)}`);
    return `  { "id": ${JSON.stringify(l.id)}, "name": ${JSON.stringify(l.name)}, "priceUsd": ${l.priceUsd}, "change": { ${change.join(", ")} } }`;
  };
  return `[\n${looks.map(row).join(",\n")}\n]\n`;
}

/** An id for a name: lowercase letters, digits and dashes, at most 40, and not one of `taken` ("mint-cap", then "mint-cap-2"). */
export function slugId(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36)
      .replace(/-+$/g, "") || "look";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id) && ID_PATTERN.test(id)) return id;
  }
}
