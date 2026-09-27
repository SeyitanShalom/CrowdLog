import type { TemplateField } from "@prisma/client";
import type { OcrCellValue } from "./ocr-provider.interface";

export type OcrValueNormalizationResult = {
  rawValue: string;
  normalizedValue: OcrCellValue;
  confidence: number;
  issues: string[];
};

const COMMON_FIELD_TERMS = [
  {
    triggers: ["name", "fullname"],
    aliases: ["full name", "student name", "participant name", "attendee name"],
  },
  {
    triggers: ["matric", "matriculation", "registration", "regno", "studentid"],
    aliases: [
      "matric no",
      "matric number",
      "matriculation number",
      "reg no",
      "registration number",
      "student id",
      "student number",
      "admission number",
    ],
  },
  {
    triggers: ["department", "dept"],
    aliases: ["dept", "department", "programme", "program", "course"],
  },
  {
    triggers: ["level", "year"],
    aliases: ["level", "year", "class", "grade"],
  },
  {
    triggers: ["email", "mail"],
    aliases: ["email", "email address", "e mail", "mail"],
  },
  {
    triggers: ["phone", "telephone", "mobile"],
    aliases: ["phone", "phone number", "mobile", "mobile number", "tel", "telephone"],
  },
  {
    triggers: ["signature", "signed", "sign"],
    aliases: ["signature", "sign", "signed", "signature mark"],
  },
  {
    triggers: ["date"],
    aliases: ["date", "attendance date", "day"],
  },
];

export function cleanOcrText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[|¦]/g, " ")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.]+|[\s:;,.]+$/g, "")
    .trim();
}

export function normalizeOcrTerm(value: string) {
  return cleanOcrText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}

export function normalizeNoisyOcrTerm(value: string) {
  const term = normalizeOcrTerm(value);
  const letterCount = (term.match(/[a-z]/g) ?? []).length;
  const digitCount = (term.match(/\d/g) ?? []).length;

  if (letterCount === 0 || digitCount > letterCount) {
    return term;
  }

  return term
    .replace(/0/g, "o")
    .replace(/[1|]/g, "i")
    .replace(/2/g, "z")
    .replace(/5/g, "s")
    .replace(/6/g, "g")
    .replace(/8/g, "b");
}

export function getOcrFieldTerms(field: TemplateField) {
  const configuredTerms = [
    field.key,
    field.label,
    ...jsonStringArray(field.aliases),
  ];
  const normalizedConfiguredTerms = configuredTerms.map(normalizeOcrTerm);
  const terms = new Set(normalizedConfiguredTerms);

  for (const group of COMMON_FIELD_TERMS) {
    const hasTrigger = group.triggers.some((trigger) =>
      normalizedConfiguredTerms.some((term) =>
        term.includes(normalizeOcrTerm(trigger)),
      ),
    );

    if (!hasTrigger) {
      continue;
    }

    for (const alias of group.aliases) {
      terms.add(normalizeOcrTerm(alias));
    }
  }

  return [...terms].filter((term) => term.length >= 2);
}

export function normalizeOcrCellValue(
  field: TemplateField,
  rawValue: string,
): OcrValueNormalizationResult {
  const rawText = cleanOcrText(rawValue);

  if (!rawText) {
    return missingValueResult(field, rawText);
  }

  switch (field.type) {
    case "EMAIL":
      return normalizeEmailValue(field, rawText);
    case "PHONE":
      return normalizePhoneValue(field, rawText);
    case "NUMBER":
      return normalizeNumberValue(field, rawText);
    case "DATE":
      return normalizeDateValue(field, rawText);
    case "SELECT":
      return normalizeSelectValue(field, rawText);
    case "SIGNATURE":
      return normalizeSignatureValue(field, rawText);
    case "TEXT":
    default:
      return {
        rawValue: rawText,
        normalizedValue: rawText,
        confidence: 0.9,
        issues: [],
      };
  }
}

export function clampConfidence(confidence: number) {
  return Math.min(0.99, Math.max(0.05, confidence));
}

function normalizeEmailValue(
  field: TemplateField,
  rawText: string,
): OcrValueNormalizationResult {
  const value = rawText
    .toLowerCase()
    .replace(/\s+(?:at|\(at\)|\[at\])\s+/g, "@")
    .replace(/\s+(?:dot|\(dot\)|\[dot\])\s+/g, ".")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*/g, ".")
    .replace(/,/g, ".")
    .replace(/c0m\b/g, "com")
    .replace(/0rg\b/g, "org")
    .replace(/c0\b/g, "co")
    .replace(/\s+/g, "");

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return {
      rawValue: rawText,
      normalizedValue: value,
      confidence: 0.94,
      issues: [],
    };
  }

  return withRequiredIssue(field, {
    rawValue: rawText,
    normalizedValue: value,
    confidence: 0.42,
    issues: ["Expected an email address."],
  });
}

function normalizePhoneValue(
  field: TemplateField,
  rawText: string,
): OcrValueNormalizationResult {
  let value = rawText
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[^\d+]/g, "");

  if (value.startsWith("00")) {
    value = `+${value.slice(2)}`;
  }

  if (value.includes("+")) {
    value = `+${value.replace(/[^\d]/g, "")}`;
  }

  const digitCount = value.replace(/\D/g, "").length;

  if (digitCount >= 7 && digitCount <= 15) {
    return {
      rawValue: rawText,
      normalizedValue: value,
      confidence: 0.9,
      issues: [],
    };
  }

  return withRequiredIssue(field, {
    rawValue: rawText,
    normalizedValue: value,
    confidence: 0.44,
    issues: ["Expected a phone number."],
  });
}

function normalizeNumberValue(
  field: TemplateField,
  rawText: string,
): OcrValueNormalizationResult {
  const value = rawText
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[,\s]/g, "");

  if (/^[-+]?\d+(\.\d+)?$/.test(value)) {
    return {
      rawValue: rawText,
      normalizedValue: Number(value),
      confidence: 0.92,
      issues: [],
    };
  }

  return withRequiredIssue(field, {
    rawValue: rawText,
    normalizedValue: rawText,
    confidence: 0.4,
    issues: ["Expected a number."],
  });
}

function normalizeDateValue(
  field: TemplateField,
  rawText: string,
): OcrValueNormalizationResult {
  const value = rawText
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/\s+/g, " ");
  const isoMatch = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const localMatch = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  const monthNameMatch = value.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{2,4})$/i);

  if (isoMatch) {
    return dateResult(field, rawText, isoMatch[1], isoMatch[2], isoMatch[3]);
  }

  if (localMatch) {
    const first = Number(localMatch[1]);
    const second = Number(localMatch[2]);
    const year = expandYear(localMatch[3]);
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;

    return dateResult(field, rawText, String(year), String(month), String(day));
  }

  if (monthNameMatch) {
    const month = monthNameToNumber(monthNameMatch[2]);

    if (month) {
      return dateResult(
        field,
        rawText,
        String(expandYear(monthNameMatch[3])),
        String(month),
        monthNameMatch[1],
      );
    }
  }

  return withRequiredIssue(field, {
    rawValue: rawText,
    normalizedValue: rawText,
    confidence: 0.4,
    issues: ["Expected a date."],
  });
}

function normalizeSelectValue(
  field: TemplateField,
  rawText: string,
): OcrValueNormalizationResult {
  const options = jsonStringArray(field.options).map(cleanOcrText).filter(Boolean);

  if (options.length === 0) {
    return {
      rawValue: rawText,
      normalizedValue: rawText,
      confidence: 0.78,
      issues: [],
    };
  }

  const optionMatch = findSelectOption(rawText, options);

  if (optionMatch) {
    return {
      rawValue: rawText,
      normalizedValue: optionMatch.option,
      confidence: optionMatch.confidence,
      issues: [],
    };
  }

  return withRequiredIssue(field, {
    rawValue: rawText,
    normalizedValue: rawText,
    confidence: 0.46,
    issues: ["Value does not match the field options."],
  });
}

function normalizeSignatureValue(
  field: TemplateField,
  rawText: string,
): OcrValueNormalizationResult {
  const term = normalizeOcrTerm(rawText);
  const truthyTerms = new Set([
    "x",
    "yes",
    "y",
    "ok",
    "tick",
    "check",
    "checked",
    "signed",
    "present",
    "signature",
  ]);
  const falseyTerms = new Set(["no", "n", "absent", "unsigned", "missing"]);

  if (truthyTerms.has(term)) {
    return {
      rawValue: rawText,
      normalizedValue: true,
      confidence: 0.88,
      issues: [],
    };
  }

  if (falseyTerms.has(term)) {
    return withRequiredIssue(field, {
      rawValue: rawText,
      normalizedValue: false,
      confidence: field.required ? 0.5 : 0.84,
      issues: field.required ? ["Missing required signature."] : [],
    });
  }

  return {
    rawValue: rawText,
    normalizedValue: true,
    confidence: 0.72,
    issues: ["Could not confirm the signature mark."],
  };
}

function missingValueResult(field: TemplateField, rawText: string) {
  const normalizedValue = field.type === "SIGNATURE" ? false : "";
  const issues = field.required ? ["Missing required value."] : [];

  return {
    rawValue: rawText,
    normalizedValue,
    confidence: field.required ? 0.34 : 0.68,
    issues,
  } satisfies OcrValueNormalizationResult;
}

function withRequiredIssue(
  field: TemplateField,
  result: OcrValueNormalizationResult,
) {
  if (!field.required) {
    return result;
  }

  return {
    ...result,
    confidence: Math.min(result.confidence, 0.5),
    issues: result.issues.includes("Missing required value.")
      ? result.issues
      : [...result.issues],
  };
}

function dateResult(
  field: TemplateField,
  rawText: string,
  yearValue: string,
  monthValue: string,
  dayValue: string,
): OcrValueNormalizationResult {
  const year = expandYear(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);

  if (!isValidDate(year, month, day)) {
    return withRequiredIssue(field, {
      rawValue: rawText,
      normalizedValue: rawText,
      confidence: 0.4,
      issues: ["Expected a valid date."],
    });
  }

  return {
    rawValue: rawText,
    normalizedValue: [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0"),
    ].join("-"),
    confidence: 0.9,
    issues: [],
  };
}

function findSelectOption(value: string, options: string[]) {
  const normalizedValue = normalizeOcrTerm(value);
  const noisyValue = normalizeNoisyOcrTerm(value);
  let bestMatch: { option: string; confidence: number } | null = null;

  for (const option of options) {
    const normalizedOption = normalizeOcrTerm(option);
    const noisyOption = normalizeNoisyOcrTerm(option);
    const possibleValues = Array.from(new Set([normalizedValue, noisyValue]));
    const possibleOptions = Array.from(new Set([normalizedOption, noisyOption]));

    if (
      possibleValues.some((possibleValue) =>
        possibleOptions.includes(possibleValue),
      )
    ) {
      return { option, confidence: 0.92 };
    }

    if (
      normalizedOption.length >= 4 &&
      possibleValues.some((possibleValue) =>
        possibleOptions.some(
          (possibleOption) =>
            possibleValue.includes(possibleOption) ||
            possibleOption.includes(possibleValue),
        ),
      )
    ) {
      bestMatch = { option, confidence: 0.78 };
      continue;
    }

    const distance = Math.min(
      ...possibleValues.flatMap((possibleValue) =>
        possibleOptions.map((possibleOption) =>
          levenshteinDistance(possibleValue, possibleOption),
        ),
      ),
    );
    const longestLength = Math.max(
      normalizedValue.length,
      noisyValue.length,
      normalizedOption.length,
      noisyOption.length,
    );
    const maxDistance = Math.max(1, Math.floor(longestLength * 0.2));

    if (distance <= maxDistance) {
      bestMatch = { option, confidence: 0.72 };
    }
  }

  return bestMatch;
}

function expandYear(value: string | number) {
  const year = Number(value);

  if (year < 100) {
    return year >= 70 ? 1900 + year : 2000 + year;
  }

  return year;
}

function isValidDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function monthNameToNumber(value: string) {
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const normalized = value.toLowerCase().slice(0, 3);
  const index = months.indexOf(normalized);

  return index >= 0 ? index + 1 : null;
}

function jsonStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function levenshteinDistance(left: string, right: string) {
  const distances = Array.from({ length: left.length + 1 }, (_, index) => [
    index,
  ]);

  for (let index = 1; index <= right.length; index += 1) {
    distances[0][index] = index;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      distances[row][column] =
        left[row - 1] === right[column - 1]
          ? distances[row - 1][column - 1]
          : Math.min(
              distances[row - 1][column - 1],
              distances[row][column - 1],
              distances[row - 1][column],
            ) + 1;
    }
  }

  return distances[left.length][right.length];
}
