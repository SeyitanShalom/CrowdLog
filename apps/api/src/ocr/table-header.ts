import type { TemplateField } from "@prisma/client";

export type OcrTableHeaderCell = {
  rowIndex: number;
  columnIndex: number;
  text: string;
  isExplicitHeader?: boolean;
};

export function detectOcrTableHeaderRowIndex(
  cells: OcrTableHeaderCell[],
  fields: TemplateField[],
  scoreFieldMatch: (text: string, field: TemplateField) => number | null,
  maxMatchScore: number,
) {
  const explicitHeaderRows = cells
    .filter((cell) => cell.isExplicitHeader)
    .map((cell) => cell.rowIndex);

  if (explicitHeaderRows.length > 0) {
    return Math.min(...explicitHeaderRows);
  }

  const rows = Array.from(
    cells.reduce((grouped, cell) => {
      const row = grouped.get(cell.rowIndex) ?? [];
      row.push(cell);
      grouped.set(cell.rowIndex, row);
      return grouped;
    }, new Map<number, OcrTableHeaderCell[]>()),
  )
    .map(([rowIndex, rowCells]) => ({ rowIndex, cells: rowCells }))
    .sort((left, right) => left.rowIndex - right.rowIndex);

  if (fields.length > 0) {
    const matchingRows = rows
      .map((row) => {
        const matches = fields.flatMap((field, fieldIndex) =>
          row.cells
            .map((cell) => ({
              fieldIndex,
              columnIndex: cell.columnIndex,
              score: scoreFieldMatch(cell.text, field),
            }))
            .filter(
              (match): match is {
                fieldIndex: number;
                columnIndex: number;
                score: number;
              } => match.score !== null && match.score <= maxMatchScore,
            ),
        );
        const usedFields = new Set<number>();
        const usedColumns = new Set<number>();
        let totalScore = 0;
        let matchCount = 0;

        for (const match of matches.sort(
          (left, right) => left.score - right.score,
        )) {
          if (
            usedFields.has(match.fieldIndex) ||
            usedColumns.has(match.columnIndex)
          ) {
            continue;
          }

          usedFields.add(match.fieldIndex);
          usedColumns.add(match.columnIndex);
          totalScore += match.score;
          matchCount += 1;
        }

        return { ...row, matchCount, totalScore };
      })
      .sort(
        (left, right) =>
          right.matchCount - left.matchCount ||
          left.totalScore - right.totalScore ||
          left.rowIndex - right.rowIndex,
      );

    if (matchingRows[0]?.matchCount) {
      return matchingRows[0].rowIndex;
    }
  }

  const headerLikeRows = rows
    .map((row) => ({ ...row, score: headerLikeScore(row.cells) }))
    .sort(
      (left, right) =>
        right.score - left.score || left.rowIndex - right.rowIndex,
    );

  const bestHeaderLikeRow = headerLikeRows[0];

  return bestHeaderLikeRow && bestHeaderLikeRow.score > 0
    ? bestHeaderLikeRow.rowIndex
    : null;
}

function headerLikeScore(cells: OcrTableHeaderCell[]) {
  let score = Math.min(cells.length, 5) * 0.25;

  for (const cell of cells) {
    const text = cell.text.trim();
    const letters = text.match(/[A-Za-z]/g) ?? [];

    if (letters.length === 0) {
      continue;
    }

    const uppercaseLetters = letters.filter(
      (letter) => letter === letter.toUpperCase(),
    ).length;
    const uppercaseRatio = uppercaseLetters / letters.length;

    if (uppercaseRatio >= 0.85 && !/\d/.test(text)) {
      score += 2;
    } else if (/\d/.test(text)) {
      score -= 1;
    }

    if (text.length > 45) {
      score -= 1;
    }
  }

  return score;
}
