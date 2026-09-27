import { Injectable } from "@nestjs/common";
import type { Prisma, TemplateField } from "@prisma/client";
import {
  type OcrExtractionInput,
  type OcrExtractionResult,
  type OcrExtractedRow,
  type OcrProvider,
} from "./ocr-provider.interface";

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

const taxaRows = [
  {
    specieId: "AB",
    genus: "Amphispiza",
    species: "bilineata",
    taxa: "Bird",
  },
  {
    specieId: "AH",
    genus: "Ammospermo",
    species: "harrisii",
    taxa: "Rodent-not censused",
  },
  {
    specieId: "AS",
    genus: "Ammodramus",
    species: "savannarum",
    taxa: "Bird",
  },
  {
    specieId: "BA",
    genus: "Baiomys",
    species: "taylori",
    taxa: "Rodent",
  },
  {
    specieId: "CB",
    genus: "Campylorhynchus",
    species: "brunneicapillus",
    taxa: "Bird",
  },
  {
    specieId: "CM",
    genus: "Calamospiza",
    species: "melanocorys",
    taxa: "Bird",
  },
  {
    specieId: "CQ",
    genus: "Callipepla",
    species: "squamata",
    taxa: "Bird",
  },
  {
    specieId: "CS",
    genus: "Crotalus",
    species: "scutulatus",
    taxa: "Reptile",
  },
  {
    specieId: "CT",
    genus: "Cnemidophorus",
    species: "tigris",
    taxa: "Reptile",
  },
  {
    specieId: "CU",
    genus: "Cnemidophorus",
    species: "uniparens",
    taxa: "Reptile",
  },
  {
    specieId: "CV",
    genus: "Crotalus",
    species: "viridis",
    taxa: "Reptile",
  },
  {
    specieId: "DM",
    genus: "Dipodomys",
    species: "merriami",
    taxa: "Rodent",
  },
  {
    specieId: "DO",
    genus: "Dipodomys",
    species: "ordii",
    taxa: "Rodent",
  },
  {
    specieId: "DS",
    genus: "Dipodomys",
    species: "spectabilis",
    taxa: "Rodent",
  },
  {
    specieId: "DX",
    genus: "Dipodomys",
    species: "sp.",
    taxa: "Rodent",
  },
  {
    specieId: "EO",
    genus: "Eumeces",
    species: "obsoletus",
    taxa: "Reptile",
  },
  {
    specieId: "GS",
    genus: "Gambelia",
    species: "silus",
    taxa: "Reptile",
  },
  {
    specieId: "NA",
    genus: "Neotoma",
    species: "albigula",
    taxa: "Rodent",
  },
  {
    specieId: "NX",
    genus: "Neotoma",
    species: "sp.",
    taxa: "Rodent",
  },
  {
    specieId: "OL",
    genus: "Onychomys",
    species: "leucogaster",
    taxa: "Rodent",
  },
  {
    specieId: "OT",
    genus: "Onychomys",
    species: "torridus",
    taxa: "Rodent",
  },
  {
    specieId: "OX",
    genus: "Onychomys",
    species: "sp.",
    taxa: "Rodent",
  },
  {
    specieId: "PB",
    genus: "Chaetodipus",
    species: "baileyi",
    taxa: "Rodent",
  },
  {
    specieId: "PC",
    genus: "Pipilo",
    species: "chlorurus",
    taxa: "Bird",
  },
  {
    specieId: "PE",
    genus: "Peromyscus",
    species: "eremicus",
    taxa: "Rodent",
  },
];

@Injectable()
export class MockOcrProvider implements OcrProvider {
  readonly name = "mock";

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    const rowCount = input.options?.rowCount ?? 4;
    const rows = this.buildRows(input.template.fields, rowCount);

    return {
      providerName: this.name,
      rawOcrJson: {
        provider: this.name,
        mode: "table",
        document: {
          id: input.document.id ?? null,
          fileName: input.document.fileName,
          fileType: input.document.fileType,
          fileUrl: input.document.fileUrl,
        },
        template: {
          id: input.template.id,
          name: input.template.name,
        },
        rows: rows.map((row) => row.data),
      } satisfies Prisma.InputJsonObject,
      rows,
      suggestedFields: [],
    };
  }

  private buildRows(fields: TemplateField[], rowCount: number) {
    return Array.from({ length: rowCount }, (_, rowIndex) => {
      const person = people[rowIndex % people.length];
      const values = fields.map((field, fieldIndex) => {
        const rawValue = this.mockValueForField(field, person, rowIndex);
        const confidence = this.mockConfidence(rowIndex, fieldIndex);

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
    }) satisfies OcrExtractedRow[];
  }

  private mockValueForField(
    field: TemplateField,
    person: (typeof people)[number],
    rowIndex: number,
  ) {
    const key = field.key.toLowerCase();
    const label = field.label.toLowerCase();
    const taxaRow = taxaRows[rowIndex % taxaRows.length];

    if (
      (key.includes("specie") && key.includes("id")) ||
      (label.includes("specie") && label.includes("id"))
    ) {
      return taxaRow.specieId;
    }

    if (key.includes("genus") || label.includes("genus")) {
      return taxaRow.genus;
    }

    if (key.includes("species") || label.includes("species")) {
      return taxaRow.species;
    }

    if (
      key.includes("taxa") ||
      key.includes("taxon") ||
      label.includes("taxa") ||
      label.includes("taxon") ||
      key === "status"
    ) {
      return taxaRow.taxa;
    }

    if (key.includes("name")) {
      return person.name;
    }

    if (
      key.includes("matric") ||
      key.includes("reg") ||
      key.includes("student")
    ) {
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
        ? field.options.filter(
            (option): option is string => typeof option === "string",
          )
        : [];

      return options[rowIndex % options.length] ?? "Option 1";
    }

    return `Value ${rowIndex + 1}`;
  }

  private mockConfidence(rowIndex: number, fieldIndex: number) {
    if (
      (rowIndex === 1 && fieldIndex === 1) ||
      (rowIndex === 2 && fieldIndex === 4)
    ) {
      return 0.58;
    }

    if ((rowIndex + fieldIndex) % 5 === 0) {
      return 0.73;
    }

    return 0.92;
  }
}
