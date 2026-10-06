"use client";

import { useState } from "react";
import type { AuthUser } from "@crowdlog/shared";
import type { AuthOtpMode } from "@/lib/api-client";
import { AuthModal, type AuthDraft } from "../auth-modal";

export function AuthPanel({
  currentUser,
  authDraft,
  isLoadingSession,
  isSigningIn,
  onAuthDraftChange,
  onRequestOtp,
  onVerifyOtp,
  onSignOut,
}: {
  currentUser: AuthUser | null;
  authDraft: AuthDraft;
  isLoadingSession: boolean;
  isSigningIn: boolean;
  onAuthDraftChange: (draft: AuthDraft) => void;
  onRequestOtp: (mode: AuthOtpMode) => Promise<boolean>;
  onVerifyOtp: (token: string) => Promise<boolean>;
  onSignOut: () => void;
}) {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  if (isLoadingSession) {
    return (
      <div className="rounded-md border border-[#fed7aa] bg-white/60 px-3 py-2 text-sm font-medium text-[#6f6359] shadow-sm">
        Checking session...
      </div>
    );
  }

  if (currentUser) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-[#fed7aa] bg-white/60 p-2 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center">
        <div className="min-w-0 text-sm">
          <span className="block truncate font-semibold text-[#2f241b]">
            {currentUser.name || currentUser.email}
          </span>
          <span className="block truncate text-xs text-[#5f7370]">
            {currentUser.email}
          </span>
          {currentUser.phone ? (
            <span className="block truncate text-xs text-[#5f7370]">
              {currentUser.phone}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningIn}
          className="h-9 rounded-md border border-[#fed7aa] bg-white/70 px-3 text-xs font-semibold text-[#70411d] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={isSigningIn}
        onClick={() => setIsAuthModalOpen(true)}
        className="action-primary h-9 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Sign in
      </button>
      {isAuthModalOpen ? (
        <AuthModal
          authDraft={authDraft}
          isSigningIn={isSigningIn}
          onAuthDraftChange={onAuthDraftChange}
          onClose={() => setIsAuthModalOpen(false)}
          onRequestOtp={onRequestOtp}
          onVerifyOtp={onVerifyOtp}
        />
      ) : null}
    </>
  );
}
