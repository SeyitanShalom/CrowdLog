import Link from "next/link";
import { useMemo, useState } from "react";
import {
  splitCommaList,
  type AttendanceDocumentSummary,
  type AttendanceRecord,
  type AuthUser,
  type CrowdLogEvent,
  type EventMember,
  type EventMemberRole,
  type EventRecordAnalytics,
  type OcrFieldSuggestion,
  type RecordCellValue,
  type RecordStatus,
  type TemplateField,
} from "@crowdlog/shared";
import { getApiFileUrl } from "@/lib/api-client";
import { EMAIL_INPUT_PATTERN } from "@/lib/email-validation";
import {
  EVENT_ROLE_LABELS,
  FIELD_TYPE_LABELS,
  RECORD_STATUS_LABELS,
  REVIEW_STATUS_FILTERS,
} from "./constants";
import { eventRoleForUser } from "./event-access";
import type {
  DocumentExtractionOptions,
  ExtractionLayout,
  ReviewStatusFilter,
  StatusMessage,
} from "./types";
import {
  confidenceLabel,
  createCsvContent,
  downloadCsv,
  filterReviewRecords,
  formatNullableConfidence,
  formatShortDateTime,
  getDocumentReports,
  getReviewerReports,
  getReviewCounts,
  percentage,
  toFileSlug,
  toPositiveInteger,
  valueToBoolean,
  valueToString,
} from "./review-utils";
type ReviewWorkspaceProps = {
  reviewEvent: CrowdLogEvent | null;
  currentUser: AuthUser | null;
  canManageEvent: boolean;
  documents: AttendanceDocumentSummary[];
  selectedDocumentId: string;
  records: AttendanceRecord[];
  analytics: EventRecordAnalytics | null;
  isLoadingDocuments: boolean;
  isUploadingDocument: boolean;
  replacingDocumentId: string | null;
  deletingDocumentIds: string[];
  isLoadingRecords: boolean;
  isMockExtracting: boolean;
  isExportingAllCsv: boolean;
  isExportingExcel: boolean;
  busyRecordIds: string[];
  memberDraft: { email: string; name: string };
  isAddingReviewer: boolean;
  removingMemberIds: string[];
  updatingMemberIds: string[];
  fieldSuggestions: OcrFieldSuggestion[];
  addingFieldKeys: string[];
  reviewStatus: StatusMessage;
  onMemberDraftChange: (draft: { email: string; name: string }) => void;
  onAddReviewer: () => void;
  onRemoveReviewer: (member: EventMember) => void;
  onChangeMemberRole: (member: EventMember, nextRole: EventMemberRole) => void;
  onSelectDocument: (documentId: string) => void;
  onUploadDocument: (file: File) => void;
  onReplaceDocument: (file: File) => void;
  onDeleteDocument: (document: AttendanceDocumentSummary) => void;
  onMockExtract: (options?: DocumentExtractionOptions) => void;
  onExportAllCsv: () => void;
  onExportExcel: () => void;
  onAddSuggestedField: (suggestion: OcrFieldSuggestion) => void;
  onCellChange: (
    recordId: string,
    fieldKey: string,
    value: RecordCellValue,
  ) => void;
  onSave: (record: AttendanceRecord) => void;
  onApprove: (record: AttendanceRecord) => void;
  onReject: (record: AttendanceRecord) => void;
};

export function ReviewWorkspace({
  reviewEvent,
  currentUser,
  canManageEvent,
  documents,
  selectedDocumentId,
  records,
  analytics,
  isLoadingDocuments,
  isUploadingDocument,
  replacingDocumentId,
  deletingDocumentIds,
  isLoadingRecords,
  isMockExtracting,
  isExportingAllCsv,
  isExportingExcel,
  busyRecordIds,
  memberDraft,
  isAddingReviewer,
  removingMemberIds,
  updatingMemberIds,
  fieldSuggestions,
  addingFieldKeys,
  reviewStatus,
  onMemberDraftChange,
  onAddReviewer,
  onRemoveReviewer,
  onChangeMemberRole,
  onSelectDocument,
  onUploadDocument,
  onReplaceDocument,
  onDeleteDocument,
  onMockExtract,
  onExportAllCsv,
  onExportExcel,
  onAddSuggestedField,
  onCellChange,
  onSave,
  onApprove,
  onReject,
}: ReviewWorkspaceProps) {
  const fields = useMemo(
    () => reviewEvent?.template.fields ?? [],
    [reviewEvent],
  );
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? null;
  const selectedDocumentIsPdf = selectedDocument?.fileType === "application/pdf";
  const [pdfPageStart, setPdfPageStart] = useState("1");
  const [pdfPageCount, setPdfPageCount] = useState("1");
  const [extractionLayout, setExtractionLayout] =
    useState<ExtractionLayout>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("all");
  const reviewCounts = useMemo(() => getReviewCounts(records), [records]);
  const filteredRecords = useMemo(
    () => filterReviewRecords(records, fields, searchQuery, statusFilter),
    [fields, records, searchQuery, statusFilter],
  );

  function exportFilteredRecords() {
    if (!reviewEvent || filteredRecords.length === 0) {
      return;
    }

    const csvContent = createCsvContent(reviewEvent, fields, filteredRecords);
    const fileName = `${toFileSlug(reviewEvent.title)}-attendance.csv`;

    downloadCsv(fileName, csvContent);
  }

  function extractionOptions() {
    return {
      layout: extractionLayout,
      ...(selectedDocumentIsPdf
        ? {
            pageStart: toPositiveInteger(pdfPageStart, 1),
            pageCount: toPositiveInteger(pdfPageCount, 1),
          }
        : {}),
    };
  }

  return (
    <section
      id="portfolio-review-workspace"
      className="glass-panel motion-rise-delay-2 scroll-mt-5 overflow-hidden rounded-lg"
    >
      <div className="panel-head flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-lg font-semibold text-[#2f241b]">
            Review extracted records
          </h2>
          <p className="mt-1 text-sm text-[#5f7370]">
            {reviewEvent
              ? reviewEvent.title
              : "Select a saved event to begin review."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          {selectedDocument ? (
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
              Layout
              <select
                value={extractionLayout}
                onChange={(event) =>
                  setExtractionLayout(event.target.value as ExtractionLayout)
                }
                className="h-10 w-32 rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
              >
                <option value="table">Table rows</option>
                <option value="form">Forms</option>
              </select>
            </label>
          ) : null}
          {selectedDocumentIsPdf ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Page start
                <input
                  type="number"
                  min={1}
                  value={pdfPageStart}
                  onChange={(event) => setPdfPageStart(event.target.value)}
                  className="h-10 w-24 rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Pages
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={pdfPageCount}
                  onChange={(event) => setPdfPageCount(event.target.value)}
                  className="h-10 w-24 rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
                />
              </label>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => onMockExtract(extractionOptions())}
            disabled={!reviewEvent || isMockExtracting}
            className="action-primary h-10 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isMockExtracting
              ? selectedDocument
                ? "Extracting..."
                : "Generating..."
              : selectedDocument
                ? "Extract selected file"
                : "Generate mock rows"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:px-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <DocumentUploadPanel
            documents={documents}
            selectedDocumentId={selectedDocumentId}
            isLoadingDocuments={isLoadingDocuments}
            isUploadingDocument={isUploadingDocument}
            replacingDocumentId={replacingDocumentId}
            deletingDocumentIds={deletingDocumentIds}
            disabled={!reviewEvent}
            onSelectDocument={onSelectDocument}
            onUploadDocument={onUploadDocument}
            onReplaceDocument={onReplaceDocument}
            onDeleteDocument={onDeleteDocument}
          />
          <EventMembersPanel
            event={reviewEvent}
            currentUser={currentUser}
            canManageEvent={canManageEvent}
            memberDraft={memberDraft}
            isAddingReviewer={isAddingReviewer}
            removingMemberIds={removingMemberIds}
            updatingMemberIds={updatingMemberIds}
            onMemberDraftChange={onMemberDraftChange}
            onAddReviewer={onAddReviewer}
            onRemoveReviewer={onRemoveReviewer}
            onChangeMemberRole={onChangeMemberRole}
          />
          <MockDocumentPreview
            event={reviewEvent}
            records={records}
            selectedDocument={selectedDocument}
          />
        </div>

        <div className="min-w-0">
          <div className="mb-3 grid gap-3">
            <div className="flex flex-wrap gap-2 text-xs font-semibold text-[#3b4a3b]">
              <SummaryPill label="Rows" value={String(reviewCounts.total)} />
              <SummaryPill
                label="Visible"
                value={String(filteredRecords.length)}
              />
              <SummaryPill
                label="Reviewed"
                value={String(reviewCounts.reviewed)}
              />
              <SummaryPill
                label="Needs review"
                value={String(reviewCounts.needsReview)}
              />
              <SummaryPill
                label="Approved"
                value={String(reviewCounts.approved)}
              />
              <SummaryPill
                label="Rejected"
                value={String(reviewCounts.rejected)}
              />
              <SummaryPill label="Draft" value={String(reviewCounts.draft)} />
              <SummaryPill label="Documents" value={String(documents.length)} />
              <SummaryPill label="Fields" value={String(fields.length)} />
            </div>

            <ReportingDashboard
              event={reviewEvent}
              currentUser={currentUser}
              documents={documents}
              records={records}
              analytics={analytics}
            />

            <div
              id="portfolio-export-actions"
              className="scroll-mt-5 grid gap-2 xl:grid-cols-[minmax(220px,1fr)_180px_auto]"
            >
              <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Search
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  disabled={!reviewEvent || records.length === 0}
                  className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
                />
              </label>

              <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as ReviewStatusFilter)
                  }
                  disabled={!reviewEvent || records.length === 0}
                  className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
                >
                  {REVIEW_STATUS_FILTERS.map((filter) => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap gap-2 self-end">
                <button
                  type="button"
                  onClick={exportFilteredRecords}
                  disabled={!reviewEvent || filteredRecords.length === 0}
                  className="h-10 rounded-md border border-[#fed7aa] bg-white px-4 text-sm font-semibold text-[#f97316] transition hover:bg-[#fff7ed] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export visible
                </button>
                <button
                  type="button"
                  onClick={onExportAllCsv}
                  disabled={!reviewEvent || isExportingAllCsv}
                  className="action-primary h-10 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExportingAllCsv ? "Exporting" : "Export all CSV"}
                </button>
                <button
                  type="button"
                  onClick={onExportExcel}
                  disabled={!reviewEvent || isExportingExcel}
                  className="h-10 rounded-md border border-[#fed7aa] bg-[#fff7ed] px-4 text-sm font-semibold text-[#f97316] transition hover:bg-[#ffedd5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExportingExcel ? "Exporting" : "Export Excel"}
                </button>
              </div>
            </div>

            <div className="min-h-5 text-sm">
              {reviewStatus ? (
                <p
                  className={
                    reviewStatus.tone === "success"
                      ? "font-medium text-[#f97316]"
                      : reviewStatus.tone === "error"
                        ? "font-medium text-[#a33f2f]"
                        : "font-medium text-[#546657]"
                  }
                >
                  {reviewStatus.text}
                </p>
              ) : null}
            </div>
          </div>

          {fieldSuggestions.length > 0 ? (
            <div className="mb-3 rounded-lg border border-[#d9d0a8] bg-[#fffaf0] p-3">
              <div className="mb-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#725b16]">
                  Suggested fields
                </p>
              </div>
              <div className="grid gap-2">
                {fieldSuggestions.map((suggestion) => {
                  const isAdding = addingFieldKeys.includes(suggestion.key);

                  return (
                    <div
                      key={suggestion.key}
                      className="flex flex-col gap-2 rounded-md border border-[#eadcae] bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#332a12]">
                          {suggestion.label}
                        </p>
                        <p className="mt-1 truncate text-xs text-[#725b16]">
                          {suggestion.sampleValues.slice(0, 4).join(", ")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onAddSuggestedField(suggestion)}
                        disabled={isAdding || !canManageEvent}
                        className="h-9 rounded-md border border-[#d2b15a] px-3 text-xs font-semibold text-[#725b16] transition hover:bg-[#fff3cf] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isAdding
                          ? "Adding"
                          : canManageEvent
                            ? "Add field"
                            : "Owner only"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-[#cfe0dc] bg-white/75 shadow-[0_14px_34px_rgba(124,69,32,0.08)]">
            <table className="min-w-full border-collapse bg-white/78 text-sm">
              <thead className="bg-[#eaf6f2] text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#5f7370]">
                <tr>
                  <th className="w-16 border-b border-[#dfe4dc] px-3 py-3">
                    Row
                  </th>
                  {fields.map((field) => (
                    <th
                      key={field.id}
                      className="min-w-[180px] border-b border-[#dfe4dc] px-3 py-3"
                    >
                      {field.label}
                    </th>
                  ))}
                  <th className="w-32 border-b border-[#dfe4dc] px-3 py-3">
                    Review status
                  </th>
                  <th className="w-56 border-b border-[#dfe4dc] px-3 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoadingRecords ? (
                  <tr>
                    <td
                      colSpan={fields.length + 3}
                      className="px-3 py-6 text-center text-sm text-[#667265]"
                    >
                      Loading records...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={fields.length + 3}
                      className="px-3 py-6 text-center text-sm text-[#667265]"
                    >
                      No extracted rows yet.
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td
                      colSpan={fields.length + 3}
                      className="px-3 py-6 text-center text-sm text-[#667265]"
                    >
                      No rows match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => {
                    const isBusy = busyRecordIds.includes(record.id);

                    return (
                      <tr key={record.id} className="border-t border-[#edf0ea] transition hover:bg-[#f6fbf8]">
                        <td className="align-top px-3 py-3 font-semibold text-[#334033]">
                          {record.rowNumber ?? "-"}
                        </td>
                        {fields.map((field) => {
                          const value = record.values.find(
                            (recordValue) => recordValue.fieldKey === field.key,
                          );
                          const isLowConfidence =
                            value?.confidence !== null &&
                            value?.confidence !== undefined &&
                            value.confidence < 0.75;
                          const validationIssues = value?.validationIssues ?? [];

                          return (
                            <td key={field.id} className="align-top px-3 py-3">
                              <ReviewCell
                                field={field}
                                value={record.data[field.key]}
                                isLowConfidence={isLowConfidence}
                                confidence={value?.confidence}
                                validationIssues={validationIssues}
                                disabled={isBusy}
                                onChange={(nextValue) =>
                                  onCellChange(record.id, field.key, nextValue)
                                }
                              />
                            </td>
                          );
                        })}
                        <td className="align-top px-3 py-3">
                          <StatusBadge status={record.status} />
                        </td>
                        <td className="align-top px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => onSave(record)}
                              disabled={isBusy}
                              className="h-9 rounded-md border border-[#cbd5c8] px-3 text-xs font-semibold text-[#334033] transition hover:bg-[#f3f5ef] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => onApprove(record)}
                              disabled={isBusy}
                              className="action-primary h-9 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => onReject(record)}
                              disabled={isBusy}
                              className="h-9 rounded-md border border-[#d9b7aa] px-3 text-xs font-semibold text-[#8a3d2d] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function DocumentUploadPanel({
  documents,
  selectedDocumentId,
  isLoadingDocuments,
  isUploadingDocument,
  replacingDocumentId,
  deletingDocumentIds,
  disabled,
  onSelectDocument,
  onUploadDocument,
  onReplaceDocument,
  onDeleteDocument,
}: {
  documents: AttendanceDocumentSummary[];
  selectedDocumentId: string;
  isLoadingDocuments: boolean;
  isUploadingDocument: boolean;
  replacingDocumentId: string | null;
  deletingDocumentIds: string[];
  disabled: boolean;
  onSelectDocument: (documentId: string) => void;
  onUploadDocument: (file: File) => void;
  onReplaceDocument: (file: File) => void;
  onDeleteDocument: (document: AttendanceDocumentSummary) => void;
}) {
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? null;
  const isReplacingSelected = replacingDocumentId === selectedDocumentId;

  return (
    <div
      id="portfolio-document-extraction"
      className="soft-card scroll-mt-5 rounded-lg p-4"
    >
      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667265]">
          Documents
        </p>
        <h3 className="mt-1 text-base font-semibold text-[#2f241b]">
          Attendance sheet
        </h3>
      </div>

      <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
        Upload file
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          disabled={disabled || isUploadingDocument}
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              onUploadDocument(file);
              event.target.value = "";
            }
          }}
          className="block w-full rounded-md border border-[#cbd5c8] bg-white text-sm text-[#334033] file:mr-3 file:h-10 file:border-0 file:bg-[#f97316] file:px-3 file:text-sm file:font-semibold file:text-white disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      <div className="mt-3 grid gap-3">
        <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
          Selected file
          <select
            value={selectedDocumentId}
            disabled={disabled || isLoadingDocuments || documents.length === 0}
            onChange={(event) => onSelectDocument(event.target.value)}
            className="h-10 w-full rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal text-[#1f2a22] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
          >
            <option value="">
              {isLoadingDocuments ? "Loading documents..." : "No file selected"}
            </option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.fileName}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
          Replace selected
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={disabled || !selectedDocument || isReplacingSelected}
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file) {
                onReplaceDocument(file);
                event.target.value = "";
              }
            }}
            className="block w-full rounded-md border border-[#cbd5c8] bg-white text-sm text-[#334033] file:mr-3 file:h-10 file:border-0 file:bg-[#fff7ed] file:px-3 file:text-sm file:font-semibold file:text-[#f97316] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>

      {documents.length > 0 ? (
        <div className="mt-4 divide-y divide-[#e5e9e2] rounded-md border border-[#e5e9e2] bg-white">
          {documents.slice(0, 4).map((document) => {
            const isDeleting = deletingDocumentIds.includes(document.id);
            const isSelected = document.id === selectedDocumentId;

            return (
              <div
                key={document.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 ${
                  isSelected ? "bg-[#edf3ea]" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDocument(document.id)}
                  className="min-w-0 text-left transition hover:text-[#f97316]"
                >
                  <span className="block truncate text-sm font-semibold text-[#2f241b]">
                    {document.fileName}
                  </span>
                  <span className="mt-1 block text-xs text-[#667265]">
                    {document.status} - {document.recordCount ?? 0} rows
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteDocument(document)}
                  disabled={disabled || isDeleting || replacingDocumentId === document.id}
                  className="h-8 rounded-md border border-[#d9b7aa] px-2.5 text-xs font-semibold text-[#8a3d2d] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting ? "Deleting" : "Delete"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function EventMembersPanel({
  event,
  currentUser,
  canManageEvent,
  memberDraft,
  isAddingReviewer,
  removingMemberIds,
  updatingMemberIds,
  onMemberDraftChange,
  onAddReviewer,
  onRemoveReviewer,
  onChangeMemberRole,
}: {
  event: CrowdLogEvent | null;
  currentUser: AuthUser | null;
  canManageEvent: boolean;
  memberDraft: { email: string; name: string };
  isAddingReviewer: boolean;
  removingMemberIds: string[];
  updatingMemberIds: string[];
  onMemberDraftChange: (draft: { email: string; name: string }) => void;
  onAddReviewer: () => void;
  onRemoveReviewer: (member: EventMember) => void;
  onChangeMemberRole: (member: EventMember, nextRole: EventMemberRole) => void;
}) {
  const currentRole = eventRoleForUser(event, currentUser);
  const members = event?.members ?? [];
  const ownerCount = members.filter((member) => member.role === "owner").length;
  const reviewerCount = members.filter(
    (member) => member.role === "reviewer",
  ).length;
  const sortedMembers = [...members].sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === "owner" ? -1 : 1;
    }

    return (left.name || left.email).localeCompare(right.name || right.email);
  });
  const ownerMembers = sortedMembers.filter((member) => member.role === "owner");
  const reviewerMembers = sortedMembers.filter(
    (member) => member.role === "reviewer",
  );
  const roleSections: Array<{
    role: EventMemberRole;
    label: string;
    members: EventMember[];
  }> = [
    { role: "owner", label: "Owners", members: ownerMembers },
    { role: "reviewer", label: "Reviewers", members: reviewerMembers },
  ];

  return (
    <div className="soft-card scroll-mt-5 rounded-lg p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667265]">
            Team management
          </p>
          <h3 className="mt-1 text-base font-semibold text-[#2f241b]">
            {event?.title ?? "No event selected"}
          </h3>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {currentRole ? (
            <span className="rounded-md border border-[#d8dfd2] bg-white px-2.5 py-1 text-xs font-semibold text-[#526052]">
              {EVENT_ROLE_LABELS[currentRole]}
            </span>
          ) : null}
          {event ? (
            <Link
              href={`/events/${event.id}/team`}
              className="inline-flex h-7 items-center rounded-md border border-[#cbd5c8] bg-white px-2.5 text-xs font-semibold text-[#334033] transition hover:bg-[#f3f5ef]"
            >
              Open team
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-md border border-[#e1e5dc] bg-white text-center">
        <div className="border-r border-[#e1e5dc] px-2 py-2.5">
          <p className="text-lg font-semibold text-[#172017]">{members.length}</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#667265]">
            Total
          </p>
        </div>
        <div className="border-r border-[#e1e5dc] px-2 py-2.5">
          <p className="text-lg font-semibold text-[#172017]">{ownerCount}</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#667265]">
            Owners
          </p>
        </div>
        <div className="px-2 py-2.5">
          <p className="text-lg font-semibold text-[#172017]">{reviewerCount}</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#667265]">
            Reviewers
          </p>
        </div>
      </div>

      {canManageEvent ? (
        <form
          className="grid gap-2 rounded-md border border-[#e1e5dc] bg-white p-3"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            onAddReviewer();
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
            Reviewer email
            <input
              type="email"
              required
              maxLength={254}
              pattern={EMAIL_INPUT_PATTERN}
              title="Enter a valid reviewer email."
              autoComplete="email"
              value={memberDraft.email}
              onChange={(inputEvent) =>
                onMemberDraftChange({
                  ...memberDraft,
                  email: inputEvent.target.value,
                })
              }
              className="h-10 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
            Display name
            <input
              maxLength={80}
              autoComplete="name"
              value={memberDraft.name}
              onChange={(inputEvent) =>
                onMemberDraftChange({
                  ...memberDraft,
                  name: inputEvent.target.value,
                })
              }
              className="h-10 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
            />
          </label>
          <button
            type="submit"
            disabled={isAddingReviewer || !memberDraft.email.trim()}
            className="action-primary h-10 rounded-md px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAddingReviewer ? "Adding reviewer" : "Add reviewer"}
          </button>
        </form>
      ) : null}

      <div className="mt-4 grid gap-3">
        {members.length === 0 ? (
          <div className="rounded-md border border-[#e5e9e2] bg-white px-3 py-3 text-sm text-[#667265]">
            No event selected.
          </div>
        ) : (
          roleSections.map((section) => (
            <section
              key={section.role}
              className="overflow-hidden rounded-md border border-[#e5e9e2] bg-white"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[#e5e9e2] bg-[#f6f8f2] px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                  {section.label}
                </p>
                <span className="rounded-md border border-[#d8dfd2] bg-white px-2 py-1 text-xs font-semibold text-[#526052]">
                  {section.members.length}
                </span>
              </div>
              <div className="divide-y divide-[#edf0ea]">
                {section.members.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-[#667265]">
                    No {section.label.toLowerCase()} yet.
                  </div>
                ) : (
                  section.members.map((member) => {
                    const isRemoving = removingMemberIds.includes(member.id);
                    const isUpdating = updatingMemberIds.includes(member.id);
                    const isCurrentUser = member.userId === currentUser?.id;
                    const canDemoteOwner =
                      member.role === "owner" && ownerCount > 1;
                    const nextRoleDisabled =
                      isUpdating ||
                      (member.role === "owner" && !canDemoteOwner);

                    return (
                      <div key={member.id} className="grid gap-3 px-3 py-3">
                        <div className="flex items-start gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#fff7ed] text-sm font-semibold text-[#f97316]">
                            {(member.name || member.email)
                              .slice(0, 1)
                              .toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[#2f241b]">
                              {member.name || member.email}
                              {isCurrentUser ? " (you)" : ""}
                            </p>
                            <p className="mt-1 truncate text-xs text-[#667265]">
                              {member.email}
                            </p>
                            <p className="mt-1 text-xs text-[#667265]">
                              Joined {formatShortDateTime(member.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                            Role
                            <select
                              value={member.role}
                              disabled={!canManageEvent || nextRoleDisabled}
                              title={
                                member.role === "owner" && !canDemoteOwner
                                  ? "Add another owner before changing this role."
                                  : undefined
                              }
                              onChange={(selectEvent) =>
                                onChangeMemberRole(
                                  member,
                                  selectEvent.target.value as EventMemberRole,
                                )
                              }
                              className="h-9 rounded-md border border-[#cbd5c8] bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#1f2a22] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
                            >
                              <option value="owner">Owner</option>
                              <option value="reviewer">Reviewer</option>
                            </select>
                          </label>

                          <div className="flex flex-wrap gap-2">
                            <span className="inline-flex h-9 items-center rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2.5 text-xs font-semibold text-[#526052]">
                              {isUpdating
                                ? "Updating"
                                : EVENT_ROLE_LABELS[member.role]}
                            </span>
                            {canManageEvent && member.role === "reviewer" ? (
                              <button
                                type="button"
                                onClick={() => onRemoveReviewer(member)}
                                disabled={isRemoving || isUpdating}
                                className="h-9 rounded-md border border-[#d9b7aa] px-2.5 text-xs font-semibold text-[#8a3d2d] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isRemoving ? "Removing" : "Remove"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function MockDocumentPreview({
  event,
  records,
  selectedDocument,
}: {
  event: CrowdLogEvent | null;
  records: AttendanceRecord[];
  selectedDocument: AttendanceDocumentSummary | null;
}) {
  const fields = event?.template.fields ?? [];
  const previewRows = records.slice(0, 5);
  const fileUrl = selectedDocument ? getApiFileUrl(selectedDocument.fileUrl) : "";

  return (
    <div className="soft-card rounded-lg p-4">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667265]">
          Sheet preview
        </p>
        <h3 className="mt-1 text-base font-semibold text-[#2f241b]">
          {selectedDocument?.fileName ?? event?.title ?? "No event selected"}
        </h3>
      </div>

      {selectedDocument ? (
        <div className="overflow-hidden rounded-md border border-[#d9dfd3] bg-white shadow-sm">
          <object
            data={fileUrl}
            type={selectedDocument.fileType ?? undefined}
            className="h-[360px] w-full bg-[#f6f8f2]"
          >
            <div className="grid h-[360px] place-items-center p-4 text-center text-sm text-[#667265]">
              Preview unavailable.
            </div>
          </object>
        </div>
      ) : (
        <div className="rounded-md border border-[#d9dfd3] bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between border-b border-[#e5e9e2] pb-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667265]">
            Attendance
          </span>
          <span className="text-xs text-[#667265]">table style</span>
        </div>
        <div className="overflow-hidden rounded-md border border-[#e5e9e2]">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead className="bg-[#f6f8f2] text-[#526052]">
              <tr>
                {fields.slice(0, 4).map((field) => (
                  <th key={field.id} className="border-b border-[#e5e9e2] p-2">
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.length > 0 ? (
                previewRows.map((record) => (
                  <tr key={record.id}>
                    {fields.slice(0, 4).map((field) => (
                      <td
                        key={field.id}
                        className="border-t border-[#f0f2ed] p-2 text-[#334033]"
                      >
                        {valueToString(record.data[field.key]) || "-"}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                Array.from({ length: 4 }, (_, rowIndex) => (
                  <tr key={rowIndex}>
                    {fields.slice(0, 4).map((field) => (
                      <td
                        key={field.id}
                        className="border-t border-[#f0f2ed] p-2 text-[#a1aaa0]"
                      >
                        -
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

function ReviewCell({
  field,
  value,
  isLowConfidence,
  confidence,
  validationIssues,
  disabled,
  onChange,
}: {
  field: TemplateField;
  value: RecordCellValue | undefined;
  isLowConfidence: boolean;
  confidence: number | null | undefined;
  validationIssues: string[];
  disabled: boolean;
  onChange: (value: RecordCellValue) => void;
}) {
  const hasValidationIssues = validationIssues.length > 0;
  const needsAttention = isLowConfidence || hasValidationIssues;
  const inputClassName = `h-10 w-full rounded-md border px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] ${
    needsAttention
      ? "border-[#d9a443] bg-[#fff8e6] focus:border-[#b7831e] focus:ring-2 focus:ring-[#f4dda6]"
      : "border-[#cbd5c8] bg-white focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
  }`;
  const selectedMultiValues = splitCommaList(valueToString(value));

  return (
    <div className="grid gap-1.5">
      {field.type === "signature" ? (
        <label
          className={`flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
            needsAttention
              ? "border-[#d9a443] bg-[#fff8e6] text-[#6b561d]"
              : "border-[#cbd5c8] bg-white text-[#334033]"
          }`}
        >
          <input
            type="checkbox"
            checked={valueToBoolean(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4 rounded border-[#aebbac] accent-[#f97316]"
          />
          Signed
        </label>
      ) : field.type === "select" ? (
        <select
          value={valueToString(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
        >
          <option value="">Choose</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === "multi_select" && field.options.length > 0 ? (
        <div
          className={`grid min-w-[12rem] gap-1.5 rounded-md border px-3 py-2 text-sm ${
            needsAttention
              ? "border-[#d9a443] bg-[#fff8e6] text-[#2f2a1a]"
              : "border-[#cbd5c8] bg-white text-[#334033]"
          } ${disabled ? "cursor-not-allowed bg-[#f1f3ee] text-[#8a9588]" : ""}`}
        >
          {field.options.map((option) => {
            const isChecked = selectedMultiValues.includes(option);

            return (
              <label
                key={option}
                className="flex min-h-6 items-center gap-2 leading-5"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={disabled}
                  onChange={(event) => {
                    const nextValues = new Set(selectedMultiValues);

                    if (event.target.checked) {
                      nextValues.add(option);
                    } else {
                      nextValues.delete(option);
                    }

                    onChange(
                      field.options
                        .filter((candidate) => nextValues.has(candidate))
                        .join(", "),
                    );
                  }}
                  className="h-4 w-4 rounded border-[#aebbac] accent-[#f97316]"
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <input
          type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
          value={valueToString(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
        />
      )}

      {isLowConfidence ? (
        <span className="text-xs font-semibold text-[#8a6516]">
          Low confidence: {confidenceLabel(confidence)}
        </span>
      ) : null}
      {hasValidationIssues ? (
        <span className="text-xs font-semibold text-[#8a6516]">
          {validationIssues.join(" ")}
        </span>
      ) : null}
    </div>
  );
}

function ReportingDashboard({
  event,
  currentUser,
  documents,
  records,
  analytics,
}: {
  event: CrowdLogEvent | null;
  currentUser: AuthUser | null;
  documents: AttendanceDocumentSummary[];
  records: AttendanceRecord[];
  analytics: EventRecordAnalytics | null;
}) {
  const counts = analytics?.summary ?? getReviewCounts(records);
  const documentReports =
    analytics?.documents ??
    getDocumentReports(documents, records).map((document) => ({
      ...document,
      reviewRate: percentage(document.reviewed, document.total),
      averageConfidence: null as number | null,
      validationIssueCells: 0,
    }));
  const reviewerReports = analytics
    ? analytics.reviewers.map((reviewer) => ({
        id: reviewer.userId,
        name: reviewer.name || reviewer.email,
        email: reviewer.email,
        role: reviewer.role,
        isCurrentUser: reviewer.userId === currentUser?.id,
        reviewed: reviewer.reviewed,
        approved: reviewer.approved,
        rejected: reviewer.rejected,
        lastReviewedAt: reviewer.lastReviewedAt,
        shareOfReviewed: reviewer.shareOfReviewed,
      }))
    : getReviewerReports(event, currentUser, records).map((reviewer) => ({
        ...reviewer,
        shareOfReviewed: undefined as number | undefined,
      }));
  const fieldReports = analytics?.fields ?? [];
  const activityReports = analytics?.activity.slice(-5) ?? [];
  const remaining = counts.draft + counts.needsReview;
  const reviewPercent = analytics
    ? analytics.summary.reviewRate
    : percentage(counts.reviewed, counts.total);
  const approvalPercent =
    analytics
      ? analytics.summary.approvalRate
      : percentage(counts.approved, counts.total);

  return (
    <div
      id="portfolio-reporting-panels"
      className="scroll-mt-5 grid gap-3 xl:grid-cols-2 2xl:grid-cols-3"
    >
      <section className="soft-card rounded-md p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          Event completion
        </p>
        <div className="mt-3 grid gap-3">
          <ReportProgress
            label="Reviewed"
            value={reviewPercent}
            detail={`${counts.reviewed}/${counts.total} rows`}
          />
          <ReportProgress
            label="Approved"
            value={approvalPercent}
            detail={`${counts.approved}/${counts.total} rows`}
            barClassName="bg-[#f97316]"
          />
          <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-[#526052]">
            <span className="rounded-md border border-[#e1e5dc] bg-white px-2 py-1.5">
              Remaining: {remaining}
            </span>
            <span className="rounded-md border border-[#e1e5dc] bg-white px-2 py-1.5">
              Rejected: {counts.rejected}
            </span>
            <span className="rounded-md border border-[#e1e5dc] bg-white px-2 py-1.5">
              Low confidence: {analytics?.summary.lowConfidenceRecords ?? 0}
            </span>
            <span className="rounded-md border border-[#e1e5dc] bg-white px-2 py-1.5">
              Issue cells: {analytics?.summary.validationIssueCells ?? 0}
            </span>
          </div>
        </div>
      </section>

      <section className="soft-card rounded-md p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          Documents
        </p>
        <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1">
          {documentReports.length === 0 ? (
            <p className="text-sm text-[#667265]">No documents yet.</p>
          ) : (
            documentReports.map((document) => (
              <div
                key={document.id}
                className="rounded-md border border-[#dce8e4] bg-white/75 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[#2f241b]">
                    {document.name}
                  </p>
                  <span className="text-xs font-semibold text-[#f97316]">
                    {document.reviewRate}%
                  </span>
                </div>
                <ProgressBar value={document.reviewRate} />
                <p className="mt-1 text-xs text-[#667265]">
                  {document.reviewed}/{document.total} reviewed -{" "}
                  {document.status} - {formatShortDateTime(document.lastActivityAt)}
                </p>
                <p className="mt-1 text-xs text-[#667265]">
                  Avg confidence {formatNullableConfidence(document.averageConfidence)} -{" "}
                  {document.validationIssueCells} issue cells
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="soft-card rounded-md p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          Reviewers
        </p>
        <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1">
          {reviewerReports.length === 0 ? (
            <p className="text-sm text-[#667265]">No reviewers yet.</p>
          ) : (
            reviewerReports.map((reviewer) => (
              <div
                key={reviewer.id}
                className="rounded-md border border-[#dce8e4] bg-white/75 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[#2f241b]">
                    {reviewer.name}
                    {reviewer.isCurrentUser ? " (you)" : ""}
                  </p>
                  <span className="shrink-0 text-xs font-semibold text-[#526052]">
                    {EVENT_ROLE_LABELS[reviewer.role]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#667265]">
                  {reviewer.reviewed} reviewed - {reviewer.approved} approved -{" "}
                  {reviewer.rejected} rejected
                </p>
                <p className="mt-1 text-xs text-[#667265]">
                  {formatShortDateTime(reviewer.lastReviewedAt)}
                  {reviewer.shareOfReviewed === undefined
                    ? ""
                    : ` - ${reviewer.shareOfReviewed}% share`}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="soft-card rounded-md p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          Field quality
        </p>
        <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1">
          {fieldReports.length === 0 ? (
            <p className="text-sm text-[#667265]">No field analytics yet.</p>
          ) : (
            fieldReports.map((field) => (
              <div
                key={field.fieldId}
                className="rounded-md border border-[#dce8e4] bg-white/75 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[#2f241b]">
                    {field.label}
                  </p>
                  <span className="shrink-0 text-xs font-semibold text-[#526052]">
                    {FIELD_TYPE_LABELS[field.type]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#667265]">
                  {field.populatedRecords} filled - {field.blankRecords} blank -{" "}
                  {field.issueCells} issue cells
                </p>
                <p className="mt-1 text-xs text-[#667265]">
                  {field.lowConfidenceCells} low-confidence cells - avg{" "}
                  {formatNullableConfidence(field.averageConfidence)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="soft-card rounded-md p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          Activity
        </p>
        <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1">
          {activityReports.length === 0 ? (
            <p className="text-sm text-[#667265]">No activity yet.</p>
          ) : (
            activityReports.map((entry) => (
              <div
                key={entry.date}
                className="rounded-md border border-[#dce8e4] bg-white/75 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#2f241b]">
                    {entry.date}
                  </p>
                  <span className="text-xs font-semibold text-[#f97316]">
                    {entry.reviewedRecords} reviewed
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#667265]">
                  {entry.createdRecords} created - {entry.approvedRecords} approved -{" "}
                  {entry.rejectedRecords} rejected
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ReportProgress({
  label,
  value,
  detail,
  barClassName = "bg-[#f97316]",
}: {
  label: string;
  value: number;
  detail: string;
  barClassName?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold text-[#3b4a3b]">
        <span>{label}</span>
        <span>{detail}</span>
      </div>
      <ProgressBar value={value} barClassName={barClassName} />
    </div>
  );
}

function ProgressBar({
  value,
  barClassName = "bg-[#f97316]",
}: {
  value: number;
  barClassName?: string;
}) {
  const width = Math.max(0, Math.min(100, value));

  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#dcebe7]">
      <div className={`h-full ${barClassName}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function StatusBadge({ status }: { status: RecordStatus }) {
  const className =
    status === "approved"
      ? "border-[#fed7aa] bg-[#fff7ed] text-[#f97316]"
      : status === "rejected"
        ? "border-[#d9b7aa] bg-[#fff1ed] text-[#8a3d2d]"
        : status === "needs_review"
          ? "border-[#d9d0a8] bg-[#fff8e6] text-[#725b16]"
          : "border-[#d8dfd2] bg-[#fafbf8] text-[#526052]";

  return (
    <span
      className={`inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-semibold ${className}`}
    >
      {RECORD_STATUS_LABELS[status]}
    </span>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-[#fed7aa] bg-white/70 px-2.5 py-1 shadow-sm">
      {label}: {value}
    </span>
  );
}

export function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card rounded-lg p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#667265]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-[#2f241b]">{value}</p>
    </div>
  );
}
