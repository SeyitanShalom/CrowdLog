"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AuthOtpMode } from "@/lib/api-client";
import { EMAIL_INPUT_PATTERN } from "@/lib/email-validation";
import { PHONE_INPUT_PATTERN } from "@/lib/phone-validation";

export type AuthDraft = {
  email: string;
  name: string;
  phone: string;
};

type AuthModalProps = {
  authDraft: AuthDraft;
  isSigningIn: boolean;
  onAuthDraftChange: (draft: AuthDraft) => void;
  onClose: () => void;
  onRequestOtp: (mode: AuthOtpMode) => Promise<boolean>;
  onVerifyOtp: (token: string) => Promise<boolean>;
};

const authModeLabels: Record<AuthOtpMode, string> = {
  "sign-in": "Sign in",
  "sign-up": "Create account",
};

export function AuthModal({
  authDraft,
  isSigningIn,
  onAuthDraftChange,
  onClose,
  onRequestOtp,
  onVerifyOtp,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthOtpMode>("sign-in");
  const [step, setStep] = useState<"profile" | "code">("profile");
  const [token, setToken] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const isCreatingAccount = mode === "sign-up";

  async function requestCode() {
    const didSendCode = await onRequestOtp(mode);

    if (didSendCode) {
      setToken("");
      setStep("code");
    }
  }

  async function verifyCode() {
    const didVerifyCode = await onVerifyOtp(token);

    if (didVerifyCode) {
      onClose();
    }
  }

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center overflow-y-auto bg-[#2f241b]/50 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onMouseDown={onClose}
    >
      <form
        className="glass-panel-strong my-auto w-full max-w-md overflow-hidden rounded-lg shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (step === "profile") {
            void requestCode();
            return;
          }

          void verifyCode();
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
              {step === "profile" ? authModeLabels[mode] : "Verify email"}
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
          {step === "profile" ? (
            <>
              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[#fed7aa] bg-white/70 p-1">
                {(Object.keys(authModeLabels) as AuthOtpMode[]).map(
                  (authMode) => (
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
                  ),
                )}
              </div>

              <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
                Name
                <input
                  required={isCreatingAccount}
                  maxLength={80}
                  autoComplete="name"
                  value={authDraft.name}
                  onChange={(event) =>
                    onAuthDraftChange({
                      ...authDraft,
                      name: event.target.value,
                    })
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
                    onAuthDraftChange({
                      ...authDraft,
                      email: event.target.value,
                    })
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
                    onAuthDraftChange({
                      ...authDraft,
                      phone: event.target.value,
                    })
                  }
                  className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
                />
              </label>
            </>
          ) : (
            <>
              <label className="grid gap-1.5 text-sm font-medium text-[#334033]">
                Verification code
                <input
                  inputMode="numeric"
                  required
                  maxLength={6}
                  pattern="\\d{6}"
                  title="Enter the 6 digit code from your email."
                  autoComplete="one-time-code"
                  value={token}
                  onChange={(event) =>
                    setToken(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="h-11 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm font-normal outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
                />
              </label>
              <button
                type="button"
                onClick={() => setStep("profile")}
                className="h-10 rounded-md border border-[#fed7aa] bg-white/80 px-3 text-sm font-semibold text-[#70411d] hover:bg-white"
              >
                Edit email
              </button>
            </>
          )}

          <button
            type="submit"
            disabled={isSigningIn}
            className="action-primary h-11 rounded-md px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningIn
              ? step === "profile"
                ? "Sending code"
                : "Verifying"
              : step === "profile"
                ? "Send code"
                : "Verify and sign in"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
