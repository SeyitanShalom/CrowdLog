"use client";

type WebsiteHelpDialogProps = {
  onClose: () => void;
};

const helpSections = [
  {
    title: "Start with the event builder",
    body: "Use the Event panel to name the attendance event, add a date, and describe what the sheet is for. Use Attendance template to add the fields you want the extracted records to contain.",
  },
  {
    title: "Build the attendance template",
    body: "Add one field for each column or form value you expect from the sheet. Pick the field type, mark important fields as required, add aliases for alternate labels, and add options for select fields.",
  },
  {
    title: "Save and reopen events",
    body: "After signing in, save the event template. Saved events appear in the right panel, where you can edit, review, open the team page, or delete owner-managed events.",
  },
  {
    title: "Upload and extract documents",
    body: "In the review workspace, upload a PDF or image attendance sheet, select the file, choose an extraction layout, and extract rows. You can replace or delete uploaded documents from the document panel.",
  },
  {
    title: "Review records",
    body: "Use the reporting cards, search, status filter, and table to review extracted rows. Edit cells when needed, then save, approve, or reject each row.",
  },
  {
    title: "Export clean data",
    body: "Export visible rows after filtering, export every row as CSV, or download the event records as an Excel file from the export controls.",
  },
  {
    title: "Manage the team",
    body: "Open Team from a saved event to add reviewers, promote additional owners, change member roles, or remove reviewers. Owners can manage templates and team access; reviewers can help clean extracted records.",
  },
];

const jumpTargets = [
  { id: "portfolio-template-builder", label: "Builder" },
  { id: "portfolio-template-summary", label: "Summary" },
  { id: "portfolio-saved-events", label: "Saved events" },
  { id: "portfolio-document-extraction", label: "Documents" },
  { id: "portfolio-reporting-panels", label: "Reports" },
  { id: "portfolio-export-actions", label: "Exports" },
];

export function WebsiteHelpDialog({ onClose }: WebsiteHelpDialogProps) {
  function jumpToSection(targetId: string) {
    const target = document.getElementById(targetId);

    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } else {
      window.location.href = `/#${targetId}`;
    }

    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#2f241b]/45 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="website-help-title"
      onMouseDown={onClose}
    >
      <div
        className="glass-panel-strong max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="panel-head flex items-start justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#f97316]">
              Website help
            </p>
            <h2
              id="website-help-title"
              className="mt-1 text-xl font-semibold text-[#2f241b]"
            >
              How to use CrowdLog
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close help"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#fed7aa] bg-white/80 text-lg font-semibold text-[#70411d] hover:bg-white"
          >
            x
          </button>
        </div>

        <div className="grid gap-5 px-5 py-5">
          <div className="soft-card rounded-lg p-4">
            <p className="text-sm font-semibold text-[#2f241b]">
              Quick navigation
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {jumpTargets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => jumpToSection(target.id)}
                  className="rounded-md border border-[#fed7aa] bg-white/80 px-3 py-2 text-xs font-semibold text-[#70411d] hover:bg-white"
                >
                  {target.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {helpSections.map((section) => (
              <section key={section.title} className="soft-card rounded-lg p-4">
                <h3 className="text-sm font-semibold text-[#2f241b]">
                  {section.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#6f6359]">
                  {section.body}
                </p>
              </section>
            ))}
          </div>

          <div className="rounded-lg border border-[#fed7aa] bg-[#fff7ed]/80 p-4 text-sm leading-6 text-[#70411d]">
            On desktop, the main workspace and the right sidebar scroll
            independently. On smaller screens, the page uses one normal scroll
            so everything stays easy to reach.
          </div>
        </div>
      </div>
    </div>
  );
}
