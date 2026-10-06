import type { AuthUser } from "@crowdlog/shared";
import { EMAIL_INPUT_PATTERN } from "@/lib/email-validation";

export function AuthPanel({
  currentUser,
  authDraft,
  isLoadingSession,
  isSigningIn,
  onAuthDraftChange,
  onSignIn,
  onSignOut,
}: {
  currentUser: AuthUser | null;
  authDraft: { email: string; name: string };
  isLoadingSession: boolean;
  isSigningIn: boolean;
  onAuthDraftChange: (draft: { email: string; name: string }) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
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
    <form
      className="grid gap-2 rounded-lg border border-[#fed7aa] bg-white/60 p-2 shadow-sm backdrop-blur-xl sm:grid-cols-[180px_160px_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        onSignIn();
      }}
    >
      <input
        type="email"
        required
        maxLength={254}
        pattern={EMAIL_INPUT_PATTERN}
        title="Enter a valid email address."
        autoComplete="email"
        value={authDraft.email}
        placeholder="Email"
        onChange={(event) =>
          onAuthDraftChange({ ...authDraft, email: event.target.value })
        }
        className="h-9 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
      />
      <input
        maxLength={80}
        autoComplete="name"
        value={authDraft.name}
        placeholder="Name"
        onChange={(event) =>
          onAuthDraftChange({ ...authDraft, name: event.target.value })
        }
        className="h-9 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
      />
      <button
        type="submit"
        disabled={isSigningIn}
        className="action-primary h-9 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSigningIn ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
