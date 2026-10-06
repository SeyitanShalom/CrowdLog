"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AuthUser,
  CrowdLogEvent,
  EventMember,
  EventMemberRole,
} from "@crowdlog/shared";
import {
  addEventReviewer,
  getCurrentSession,
  getEvent,
  removeEventMember,
  requestEmailOtp,
  signOut as apiSignOut,
  updateEventMember,
  verifyEmailOtp,
  type AuthOtpMode,
} from "@/lib/api-client";
import {
  EMAIL_INPUT_PATTERN,
  isValidEmailAddress,
} from "@/lib/email-validation";
import { isValidPhoneNumber } from "@/lib/phone-validation";
import { AuthModal, type AuthDraft } from "./auth-modal";
import { WebsiteHelpDialog } from "./help-dialog";

const EVENT_ROLE_LABELS: Record<EventMemberRole, string> = {
  owner: "Owner",
  reviewer: "Reviewer",
};

type StatusMessage = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

export function TeamManagementRoute() {
  const params = useParams();
  const eventIdParam = params.eventId;
  const eventId = Array.isArray(eventIdParam)
    ? eventIdParam[0]
    : eventIdParam ?? "";
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authDraft, setAuthDraft] = useState<AuthDraft>({
    email: "",
    name: "",
    phone: "",
  });
  const [event, setEvent] = useState<CrowdLogEvent | null>(null);
  const [memberDraft, setMemberDraft] = useState({ email: "", name: "" });
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isLoadingEvent, setIsLoadingEvent] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isAddingReviewer, setIsAddingReviewer] = useState(false);
  const [removingMemberIds, setRemovingMemberIds] = useState<string[]>([]);
  const [updatingMemberIds, setUpdatingMemberIds] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const currentRole = eventRoleForUser(event, currentUser);
  const canManageEvent = currentRole === "owner";
  const members = useMemo(() => sortMembers(event?.members ?? []), [event]);
  const ownerCount = members.filter((member) => member.role === "owner").length;
  const reviewerCount = members.filter(
    (member) => member.role === "reviewer",
  ).length;
  const ownerMembers = members.filter((member) => member.role === "owner");
  const reviewerMembers = members.filter(
    (member) => member.role === "reviewer",
  );

  const loadEvent = useCallback(async () => {
    if (!eventId) {
      setEvent(null);
      setStatus({ tone: "error", text: "Event id is missing." });
      return;
    }

    setIsLoadingEvent(true);

    try {
      const nextEvent = await getEvent(eventId);

      setEvent(nextEvent);
      setStatus(null);
    } catch (error) {
      setEvent(null);
      setStatus({
        tone: "error",
        text: `Could not load this event. ${getErrorMessage(error)}`,
      });
    } finally {
      setIsLoadingEvent(false);
    }
  }, [eventId]);

  useEffect(() => {
    let shouldIgnore = false;

    async function loadInitialState() {
      setIsLoadingSession(true);

      try {
        const session = await getCurrentSession();

        if (shouldIgnore) {
          return;
        }

        setCurrentUser(session.user);
        setAuthDraft((currentDraft) => ({
          ...currentDraft,
          email: session.user?.email ?? currentDraft.email,
          name: session.user?.name ?? currentDraft.name,
          phone: session.user?.phone ?? currentDraft.phone,
        }));

        if (!session.user) {
          setStatus({
            tone: "info",
            text: "Sign in to open this event team.",
          });
          return;
        }

        await loadEvent();
      } catch (error) {
        if (!shouldIgnore) {
          setStatus({
            tone: "error",
            text: `Could not load team data. ${getErrorMessage(error)}`,
          });
        }
      } finally {
        if (!shouldIgnore) {
          setIsLoadingSession(false);
        }
      }
    }

    loadInitialState();

    return () => {
      shouldIgnore = true;
    };
  }, [loadEvent]);

  function validateAuthDraft(mode: AuthOtpMode) {
    const email = authDraft.email.trim();
    const name = authDraft.name.trim();
    const phone = authDraft.phone.trim();

    if (!email) {
      setStatus({ tone: "error", text: "Email is required." });
      return;
    }

    if (!isValidEmailAddress(email)) {
      setStatus({ tone: "error", text: "Enter a valid email address." });
      return;
    }

    if (mode === "sign-up" && !name) {
      setStatus({ tone: "error", text: "Name is required to create an account." });
      return;
    }

    if (mode === "sign-up" && !phone) {
      setStatus({
        tone: "error",
        text: "Phone number is required to create an account.",
      });
      return;
    }

    if (phone && !isValidPhoneNumber(phone)) {
      setStatus({ tone: "error", text: "Enter a valid phone number." });
      return;
    }

    return { email, name, phone };
  }

  async function requestAuthOtp(mode: AuthOtpMode) {
    const authProfile = validateAuthDraft(mode);

    if (!authProfile) {
      return false;
    }

    setIsSigningIn(true);
    setStatus({ tone: "info", text: "Sending verification code." });

    try {
      await requestEmailOtp({
        mode,
        email: authProfile.email,
        name: authProfile.name || undefined,
        phone: authProfile.phone || undefined,
      });
      setStatus({ tone: "success", text: "Verification code sent." });

      return true;
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not send code. ${getErrorMessage(error)}`,
      });

      return false;
    } finally {
      setIsSigningIn(false);
    }
  }

  async function verifyAuthOtp(token: string) {
    const authProfile = validateAuthDraft("sign-in");

    if (!authProfile) {
      return false;
    }

    setIsSigningIn(true);
    setStatus({ tone: "info", text: "Verifying email." });

    try {
      const result = await verifyEmailOtp({
        email: authProfile.email,
        token,
        name: authProfile.name || undefined,
        phone: authProfile.phone || undefined,
      });

      setCurrentUser(result.user);
      setAuthDraft({
        email: result.user.email,
        name: result.user.name ?? authProfile.name,
        phone: result.user.phone ?? authProfile.phone,
      });
      setIsAuthModalOpen(false);
      await loadEvent();

      return true;
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not verify code. ${getErrorMessage(error)}`,
      });

      return false;
    } finally {
      setIsSigningIn(false);
    }
  }

  async function signOut() {
    await apiSignOut();
    setCurrentUser(null);
    setEvent(null);
    setIsAuthModalOpen(false);
    setMemberDraft({ email: "", name: "" });
    setStatus({ tone: "info", text: "Signed out." });
  }

  async function addReviewer() {
    if (!event || !canManageEvent) {
      setStatus({ tone: "error", text: "Only event owners can add reviewers." });
      return;
    }

    const email = memberDraft.email.trim();
    const name = memberDraft.name.trim();

    if (!email) {
      setStatus({ tone: "error", text: "Reviewer email is required." });
      return;
    }

    if (!isValidEmailAddress(email)) {
      setStatus({ tone: "error", text: "Enter a valid reviewer email." });
      return;
    }

    setIsAddingReviewer(true);
    setStatus({ tone: "info", text: "Adding reviewer." });

    try {
      const nextEvent = await addEventReviewer(event.id, {
        email,
        name: name || undefined,
      });

      setEvent(nextEvent);
      setMemberDraft({ email: "", name: "" });
      setStatus({ tone: "success", text: "Reviewer added and invitation queued." });
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not add reviewer. ${getErrorMessage(error)}`,
      });
    } finally {
      setIsAddingReviewer(false);
    }
  }

  async function removeReviewer(member: EventMember) {
    if (!event || !canManageEvent) {
      setStatus({
        tone: "error",
        text: "Only event owners can remove reviewers.",
      });
      return;
    }

    if (!window.confirm(`Remove ${member.email} from this event?`)) {
      return;
    }

    setRemovingMemberIds((currentIds) => [...currentIds, member.id]);
    setStatus({ tone: "info", text: "Removing reviewer." });

    try {
      const nextEvent = await removeEventMember(event.id, member.id);

      setEvent(nextEvent);
      setStatus({ tone: "success", text: "Reviewer removed." });
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not remove reviewer. ${getErrorMessage(error)}`,
      });
    } finally {
      setRemovingMemberIds((currentIds) =>
        currentIds.filter((memberId) => memberId !== member.id),
      );
    }
  }

  async function changeMemberRole(member: EventMember, nextRole: EventMemberRole) {
    if (!event || !canManageEvent) {
      setStatus({
        tone: "error",
        text: "Only event owners can change member roles.",
      });
      return;
    }

    if (member.role === nextRole) {
      return;
    }

    if (member.role === "owner" && nextRole === "reviewer" && ownerCount <= 1) {
      setStatus({
        tone: "error",
        text: "Add another owner before changing this owner to reviewer.",
      });
      return;
    }

    const targetName = member.name || member.email;
    const isCurrentUser = member.userId === currentUser?.id;
    const confirmText =
      nextRole === "owner"
        ? `Make ${targetName} an owner of this event?`
        : isCurrentUser
          ? "Change your role to reviewer? You will lose owner controls for this event."
          : `Change ${targetName} to reviewer?`;

    if (!window.confirm(confirmText)) {
      return;
    }

    setUpdatingMemberIds((currentIds) => [...currentIds, member.id]);
    setStatus({ tone: "info", text: "Updating member role." });

    try {
      const nextEvent = await updateEventMember(event.id, member.id, {
        role: nextRole,
      });

      setEvent(nextEvent);
      setStatus({
        tone: "success",
        text:
          nextRole === "owner"
            ? "Member promoted to owner."
            : "Member changed to reviewer.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Could not update member role. ${getErrorMessage(error)}`,
      });
    } finally {
      setUpdatingMemberIds((currentIds) =>
        currentIds.filter((memberId) => memberId !== member.id),
      );
    }
  }

  return (
    <div className="app-shell min-h-screen text-[#2f241b] xl:flex xl:h-screen xl:flex-col xl:overflow-hidden">
      <header className="sticky top-0 z-30 shrink-0 border-b border-white/50 bg-white/62 shadow-[0_18px_60px_rgba(124,69,32,0.08)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div className="motion-rise flex min-w-0 items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#f97316] via-[#fb923c] to-[#d76d37] text-sm font-black text-white shadow-[0_14px_30px_rgba(249,115,22,0.25)]">
              CL
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#f97316]">
                CrowdLog team
              </p>
              <h1 className="mt-1 truncate text-2xl font-semibold text-[#2f241b]">
                {event?.title ?? "Event team"}
              </h1>
            </div>
          </div>
          <div className="motion-rise-delay-1 flex flex-wrap gap-2">
            <button
              type="button"
              aria-label="Open website help"
              title="Open website help"
              onClick={() => setIsHelpOpen(true)}
              className="grid h-10 w-10 place-items-center rounded-full border border-[#fed7aa] bg-white/80 text-sm font-black text-[#f97316] shadow-sm hover:bg-white"
            >
              ?
            </button>
            <Link
              href={event ? `/?eventId=${encodeURIComponent(event.id)}` : "/"}
              className="inline-flex h-10 items-center rounded-md border border-[#fed7aa] bg-white/70 px-3 text-sm font-semibold text-[#70411d] shadow-sm transition hover:bg-white"
            >
              Review workspace
            </Link>
            {currentUser ? (
              <button
                type="button"
                onClick={signOut}
                className="h-10 rounded-md border border-[#d9b7aa] px-3 text-sm font-semibold text-[#8a3d2d] transition hover:bg-[#fff1ed]"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {isHelpOpen ? (
        <WebsiteHelpDialog onClose={() => setIsHelpOpen(false)} />
      ) : null}

      {isAuthModalOpen ? (
        <AuthModal
          authDraft={authDraft}
          isSigningIn={isSigningIn}
          onAuthDraftChange={setAuthDraft}
          onClose={() => setIsAuthModalOpen(false)}
          onRequestOtp={requestAuthOtp}
          onVerifyOtp={verifyAuthOtp}
        />
      ) : null}

      <main className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[320px_minmax(0,1fr)] xl:overflow-hidden">
        <aside className="space-y-5 xl:min-h-0 xl:overflow-y-auto xl:pr-1 xl:pb-5">
          <section className="glass-panel-strong motion-rise rounded-md p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
              Signed in
            </p>
            {isLoadingSession ? (
              <p className="mt-3 text-sm text-[#667265]">Checking session...</p>
            ) : currentUser ? (
              <div className="mt-3">
                <p className="truncate text-sm font-semibold text-[#2f241b]">
                  {currentUser.name || currentUser.email}
                </p>
                <p className="mt-1 truncate text-xs text-[#667265]">
                  {currentUser.email}
                </p>
                {currentUser.phone ? (
                  <p className="mt-1 truncate text-xs text-[#667265]">
                    {currentUser.phone}
                  </p>
                ) : null}
                {currentRole ? (
                  <span className="mt-3 inline-flex rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2 py-1 text-xs font-semibold text-[#526052]">
                    {EVENT_ROLE_LABELS[currentRole]}
                  </span>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                disabled={isSigningIn}
                className="action-primary mt-3 h-10 w-full rounded-md px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Sign in
              </button>
            )}
          </section>

          <section className="glass-panel-strong motion-rise-delay-1 rounded-md p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
              Team counts
            </p>
            <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-md border border-[#dce8e4] bg-white/60 text-center">
              <SummaryCount label="Total" value={members.length} />
              <SummaryCount label="Owners" value={ownerCount} />
              <SummaryCount label="Reviewers" value={reviewerCount} />
            </div>
            {event ? (
              <p className="mt-3 text-xs text-[#667265]">
                Updated {formatShortDateTime(event.updatedAt)}
              </p>
            ) : null}
          </section>

          {canManageEvent ? (
            <section className="glass-panel-strong motion-rise-delay-2 rounded-md p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Add reviewer
              </p>
              <form
                className="mt-3 grid gap-3"
                onSubmit={(submitEvent) => {
                  submitEvent.preventDefault();
                  addReviewer();
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
                      setMemberDraft({
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
                      setMemberDraft({
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
            </section>
          ) : null}
        </aside>

        <section className="glass-panel motion-rise-delay-1 min-w-0 overflow-hidden rounded-md xl:min-h-0 xl:overflow-y-auto">
          <div className="panel-head flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
                Roster
              </p>
              <h2 className="mt-1 text-lg font-semibold text-[#2f241b]">
                {event?.title ?? "No event loaded"}
              </h2>
            </div>
            {isLoadingEvent ? (
              <span className="rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2.5 py-1 text-xs font-semibold text-[#526052]">
                Loading
              </span>
            ) : null}
          </div>

          <StatusBanner status={status} />

          {!currentUser && !isLoadingSession ? (
            <EmptyState text="Sign in with an event member account." />
          ) : members.length === 0 ? (
            <EmptyState
              text={isLoadingEvent ? "Loading roster..." : "No members found."}
            />
          ) : (
            <div className="grid gap-4 p-4">
              <MemberSection
                label="Owners"
                members={ownerMembers}
                currentUser={currentUser}
                canManageEvent={canManageEvent}
                ownerCount={ownerCount}
                removingMemberIds={removingMemberIds}
                updatingMemberIds={updatingMemberIds}
                onRemoveReviewer={removeReviewer}
                onChangeMemberRole={changeMemberRole}
              />
              <MemberSection
                label="Reviewers"
                members={reviewerMembers}
                currentUser={currentUser}
                canManageEvent={canManageEvent}
                ownerCount={ownerCount}
                removingMemberIds={removingMemberIds}
                updatingMemberIds={updatingMemberIds}
                onRemoveReviewer={removeReviewer}
                onChangeMemberRole={changeMemberRole}
              />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function MemberSection({
  label,
  members,
  currentUser,
  canManageEvent,
  ownerCount,
  removingMemberIds,
  updatingMemberIds,
  onRemoveReviewer,
  onChangeMemberRole,
}: {
  label: string;
  members: EventMember[];
  currentUser: AuthUser | null;
  canManageEvent: boolean;
  ownerCount: number;
  removingMemberIds: string[];
  updatingMemberIds: string[];
  onRemoveReviewer: (member: EventMember) => void;
  onChangeMemberRole: (member: EventMember, nextRole: EventMemberRole) => void;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-[#dce8e4] bg-white/62 shadow-[0_12px_30px_rgba(124,69,32,0.08)]">
      <div className="flex items-center justify-between gap-3 border-b border-[#dce8e4] bg-[#eaf6f2] px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
          {label}
        </p>
        <span className="rounded-md border border-[#d8dfd2] bg-white px-2 py-1 text-xs font-semibold text-[#526052]">
          {members.length}
        </span>
      </div>

      {members.length === 0 ? (
        <div className="px-3 py-4 text-sm text-[#667265]">
          No {label.toLowerCase()} yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-white/75 text-xs font-semibold uppercase tracking-[0.08em] text-[#667265]">
              <tr>
                <th className="border-b border-[#edf0ea] px-3 py-2">Member</th>
                <th className="border-b border-[#edf0ea] px-3 py-2">Role</th>
                <th className="border-b border-[#edf0ea] px-3 py-2">Joined</th>
                <th className="border-b border-[#edf0ea] px-3 py-2 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0ea]">
              {members.map((member) => {
                const isRemoving = removingMemberIds.includes(member.id);
                const isUpdating = updatingMemberIds.includes(member.id);
                const isCurrentUser = member.userId === currentUser?.id;
                const canDemoteOwner =
                  member.role === "owner" && ownerCount > 1;
                const nextRoleDisabled =
                  isUpdating || (member.role === "owner" && !canDemoteOwner);

                return (
                  <tr key={member.id} className="align-middle transition hover:bg-[#f6fbf8]">
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#fff7ed] text-sm font-semibold text-[#f97316]">
                          {(member.name || member.email)
                            .slice(0, 1)
                            .toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[#2f241b]">
                            {member.name || member.email}
                            {isCurrentUser ? " (you)" : ""}
                          </p>
                          <p className="mt-1 truncate text-xs text-[#667265]">
                            {member.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
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
                        className="h-9 rounded-md border border-[#cbd5c8] bg-white px-2 text-sm text-[#1f2a22] outline-none transition disabled:cursor-not-allowed disabled:bg-[#f1f3ee] focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
                      >
                        <option value="owner">Owner</option>
                        <option value="reviewer">Reviewer</option>
                      </select>
                    </td>
                    <td className="px-3 py-3 text-sm text-[#526052]">
                      {formatShortDateTime(member.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <span className="inline-flex h-9 items-center rounded-md border border-[#d8dfd2] bg-[#fafbf8] px-2.5 text-xs font-semibold text-[#526052]">
                          {isUpdating ? "Updating" : EVENT_ROLE_LABELS[member.role]}
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-[#dce8e4] px-2 py-2.5 last:border-r-0">
      <p className="text-lg font-semibold text-[#2f241b]">{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#667265]">
        {label}
      </p>
    </div>
  );
}

function StatusBanner({ status }: { status: StatusMessage }) {
  if (!status) {
    return null;
  }

  const className =
    status.tone === "success"
      ? "border-[#fed7aa] bg-[#fff7ed] text-[#f97316]"
      : status.tone === "error"
        ? "border-[#d9b7aa] bg-[#fff1ed] text-[#8a3d2d]"
        : "border-[#d8dfd2] bg-[#fafbf8] text-[#526052]";

  return (
    <div className={`border-b px-4 py-3 text-sm font-medium ${className}`}>
      {status.text}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-4 py-10 text-center text-sm text-[#667265]">{text}</div>;
}

function eventRoleForUser(
  event: CrowdLogEvent | null,
  user: AuthUser | null,
): EventMemberRole | null {
  if (!event || !user) {
    return null;
  }

  const membership = event.members.find((member) => member.userId === user.id);

  if (membership) {
    return membership.role;
  }

  return event.ownerId === user.id ? "owner" : null;
}

function sortMembers(members: EventMember[]) {
  return [...members].sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === "owner" ? -1 : 1;
    }

    return (left.name || left.email).localeCompare(right.name || right.email);
  });
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) {
    return "No activity";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No activity";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}
