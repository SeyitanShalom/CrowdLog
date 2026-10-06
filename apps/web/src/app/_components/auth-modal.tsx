"use client";

import { useState } from "react";
import { EMAIL_INPUT_PATTERN } from "@/lib/email-validation";
import { PHONE_INPUT_PATTERN } from "@/lib/phone-validation";

export type AuthDraft = {
  email: string;
  name: string;
  phone: string;
};

type AuthMode = "sign-in" | "sign-up";

type AuthModalProps = {
  authDraft: AuthDraft;
  isSigningIn: boolean;
  onAuthDraftChange: (draft: AuthDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
};

const authModeLabels: Record<AuthMode, string> = {
  "sign-in": "Sign in",
  "sign-up": "Create account",
};

export function AuthModal({
  authDraft,
  isSigningIn,
  onAuthDraftChange,
  onClose,
  onSubmit,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const isCreatingAccount = mode === "sign-up";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#2f241b]/45 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onMouseDown={onClose}
    >
      <form
        className="glass-panel-strong w-full max-w-md overflow-hidden rounded-lg"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="panel-head flex items-start justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#f97316]">
              CrowdLog account
            </p>
            <h2
              id="auth-modal-title"
              className="mt-1 text-xl font-semibold text-[#2f241b]"
            >
              {authModeLabels[mode]}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close auth form"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#fed7aa] bg-white/80 text-lg font-semibold text-[#70411d] hover:bg-white"
          >
            x
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5">
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[#fed7aa] bg-white/70 p-1">
            {(Object.keys(authModeLabels) as AuthMode[]).map((authMode) => (
              <button
                key={authMode}
                type="button"
                onClick={() => setMode(authMode)}
                className={`h-9 rounded-md text-sm font-semibold transition ${
                  mode === authMode
                    ? "bg-[#f97316] text-white shadow-sm"
                    : "text-[#70411d] hover:bg-[#fff7ed]"
                }`}
              >
                {authModeLabels[authMode]}
              </button>
            ))}
          </div>

          <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
            Name
            <input
              required={isCreatingAccount}
              maxLength={80}
              autoComplete="name"
              value={authDraft.name}
              onChange={(event) =>
                onAuthDraftChange({ ...authDraft, name: event.target.value })
              }
              className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
            Email
            <input
              type="email"
              required
              maxLength={254}
              pattern={EMAIL_INPUT_PATTERN}
              title="Enter a valid email address."
              autoComplete="email"
              value={authDraft.email}
              onChange={(event) =>
                onAuthDraftChange({ ...authDraft, email: event.target.value })
              }
              className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
            Phone number
            <input
              type="tel"
              required={isCreatingAccount}
              maxLength={32}
              pattern={PHONE_INPUT_PATTERN}
              title="Enter a valid phone number."
              autoComplete="tel"
              value={authDraft.phone}
              onChange={(event) =>
                onAuthDraftChange({ ...authDraft, phone: event.target.value })
              }
              className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
            />
          </label>

          <button
            type="submit"
            disabled={isSigningIn}
            className="action-primary h-11 rounded-md px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningIn ? "Signing in" : authModeLabels[mode]}
          </button>
        </div>
      </form>
    </div>
  );
}
