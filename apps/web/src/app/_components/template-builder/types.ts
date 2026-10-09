import type { RecordStatus } from "@crowdlog/shared";

export type StatusMessage = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

export type ExtractionLayout = "table" | "form";

export type DocumentExtractionOptions = {
  rowCount?: number;
  pageStart?: number;
  pageCount?: number;
  layout?: ExtractionLayout;
};

export type ReviewStatusFilter = RecordStatus | "all";
