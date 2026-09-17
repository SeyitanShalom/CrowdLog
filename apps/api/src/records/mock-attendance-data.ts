import type { TemplateField } from "@prisma/client";

export type MockCell = {
  rawValue: string | number | boolean | null;
  normalizedValue: string | number | boolean | null;
  confidence: number;
};

export type MockRow = {
  rowNumber: number;
  data: Record<string, string | number | boolean | null>;
  values: Array<MockCell & { field: TemplateField }>;
  confidenceScore: number;
};

const people = [
  { name: "Ada Okafor", department: "Computer Science", level: "300" },
  { name: "Tunde Balogun", department: "Computer Science", level: "400" },
  { name: "Maryam Bello", department: "Software Engineering", level: "200" },
  { name: "Chinedu Eze", department: "Information Systems", level: "300" },
  { name: "Ifeoma Nwosu", department: "Cybersecurity", level: "500" },
  { name: "Samuel Johnson", department: "Computer Science", level: "100" },
];

const organizations = [
  "Apex Digital Lab",
  "Blue Ridge School",
  "FutureWorks Hub",
  "Northgate College",
  "CodeSpring Studio",
  "Lagos Tech Circle",
];

export function buildMockRows(fields: TemplateField[], rowCount: number) {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const person = people[rowIndex % people.length];
    const values = fields.map((field, fieldIndex) => {
      const rawValue = mockValueForField(field, person, rowIndex);
      const confidence = mockConfidence(rowIndex, fieldIndex);

      return {
        field,
        rawValue,
        normalizedValue: rawValue,
        confidence,
      };
    });

    const data = Object.fromEntries(
      values.map((value) => [value.field.key, value.normalizedValue]),
    );
    const confidenceScore =
      values.reduce((sum, value) => sum + value.confidence, 0) / values.length;

    return {
      rowNumber: rowIndex + 1,
      data,
      values,
      confidenceScore: Number(confidenceScore.toFixed(2)),
    };
  });
}

function mockValueForField(
  field: TemplateField,
  person: (typeof people)[number],
  rowIndex: number,
) {
  const key = field.key.toLowerCase();

  if (key.includes("name")) {
    return person.name;
  }

  if (key.includes("matric") || key.includes("reg") || key.includes("student")) {
    return `CSC/2026/${String(rowIndex + 41).padStart(3, "0")}`;
  }

  if (key.includes("department") || key === "dept") {
    return person.department;
  }

  if (key.includes("level") || key.includes("year")) {
    return person.level;
  }

  if (key.includes("email")) {
    return `${person.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
  }

  if (key.includes("phone") || key.includes("tel")) {
    return `080${String(23000000 + rowIndex * 3719).slice(0, 8)}`;
  }

  if (key.includes("organization") || key.includes("company")) {
    return organizations[rowIndex % organizations.length];
  }

  if (key.includes("signature") || key.includes("sign")) {
    return rowIndex === 2 ? false : true;
  }

  if (field.type === "DATE") {
    return "2026-09-17";
  }

  if (field.type === "NUMBER") {
    return rowIndex + 1;
  }

  if (field.type === "SELECT") {
    const options = Array.isArray(field.options)
      ? field.options.filter((option): option is string => typeof option === "string")
      : [];

    return options[rowIndex % options.length] ?? "Option 1";
  }

  return `Value ${rowIndex + 1}`;
}

function mockConfidence(rowIndex: number, fieldIndex: number) {
  if ((rowIndex === 1 && fieldIndex === 1) || (rowIndex === 2 && fieldIndex === 4)) {
    return 0.58;
  }

  if ((rowIndex + fieldIndex) % 5 === 0) {
    return 0.73;
  }

  return 0.92;
}
