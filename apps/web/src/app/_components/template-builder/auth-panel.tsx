"use client";

import { useState } from "react";
import type { AuthUser } from "@crowdlog/shared";
import {
  AuthModal,
  type AuthDraft,
  type AuthStatusMessage,
} from "../auth-modal";

export function AuthPanel({
  currentUser,
  authDraft,
  authStatus,
  isLoadingSession,
  isSigningIn,
  onAuthDraftChange,
  onAuthStatusReset,
  onRequestOtp,
  onSignIn,
  onVerifyOtp,
  onSignOut,
}: {
  currentUser: AuthUser | null;
  authDraft: AuthDraft;
  authStatus: AuthStatusMessage;
  isLoadingSession: boolean;
  isSigningIn: boolean;
  onAuthDraftChange: (draft: AuthDraft) => void;
  onAuthStatusReset: () => void;
  onRequestOtp: () => Promise<boolean>;
  onSignIn: () => Promise<boolean>;
  onVerifyOtp: (token: string) => Promise<boolean>;
  onSignOut: () => void;
}) {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  if (isLoadingSession) {
    return (
      <div className="rounded-lg border border-[#dce5df] bg-white px-3 py-2 text-sm font-medium text-[#68776f]">
        Checking session...
      </div>
    );
  }

  if (currentUser) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-[#dce5df] bg-white p-1.5 sm:gap-3 sm:p-2">
        <div className="min-w-0 flex-1 text-xs sm:text-sm">
          <span className="block truncate font-semibold text-[#26362f]">
            {currentUser.name || currentUser.email}
          </span>
          <span className="hidden truncate text-xs text-[#68776f] sm:block">
            {currentUser.email}
          </span>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningIn}
          className="h-10 shrink-0 rounded-lg border border-[#dce5df] bg-white px-2.5 text-xs font-semibold text-[#52685e] transition hover:bg-[#f5f8f6] disabled:cursor-not-allowed disabled:opacity-50 sm:px-3"
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
        onClick={() => {
          onAuthStatusReset();
          setIsAuthModalOpen(true);
        }}
        className="action-primary h-10 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Sign in
      </button>
      {isAuthModalOpen ? (
        <AuthModal
          authDraft={authDraft}
          authStatus={authStatus}
          isSigningIn={isSigningIn}
          onAuthDraftChange={onAuthDraftChange}
          onAuthStatusReset={onAuthStatusReset}
          onClose={() => setIsAuthModalOpen(false)}
          onRequestOtp={onRequestOtp}
          onSignIn={onSignIn}
          onVerifyOtp={onVerifyOtp}
        />
      ) : null}
    </>
  );
}
