export function normalizeFieldKey(label: string) {
  const key = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return key || "field";
}

export function dedupeFieldKey(baseKey: string, takenKeys: string[]) {
  const taken = new Set(takenKeys);
  let candidate = baseKey;
  let suffix = 2;

  while (taken.has(candidate)) {
    candidate = `${baseKey}_${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export function makeClientId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.();

  if (randomId) {
    return `${prefix}_${randomId}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function splitCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
