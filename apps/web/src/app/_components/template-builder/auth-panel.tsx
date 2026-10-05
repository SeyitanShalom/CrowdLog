import type { AuthUser } from "@crowdlog/shared";

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
      <div className="text-sm font-medium text-[#667265]">
        Checking session...
      </div>
    );
  }

  if (currentUser) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 text-sm">
          <span className="block truncate font-semibold text-[#172017]">
            {currentUser.name || currentUser.email}
          </span>
          <span className="block truncate text-xs text-[#667265]">
            {currentUser.email}
          </span>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningIn}
          className="h-9 rounded-md border border-[#cbd5c8] px-3 text-xs font-semibold text-[#334033] transition hover:bg-[#f3f5ef] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-2 sm:grid-cols-[180px_160px_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        onSignIn();
      }}
    >
      <input
        type="email"
        value={authDraft.email}
        placeholder="Email"
        onChange={(event) =>
          onAuthDraftChange({ ...authDraft, email: event.target.value })
        }
        className="h-9 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
      />
      <input
        value={authDraft.name}
        placeholder="Name"
        onChange={(event) =>
          onAuthDraftChange({ ...authDraft, name: event.target.value })
        }
        className="h-9 rounded-md border border-[#cbd5c8] bg-white px-3 text-sm outline-none transition focus:border-[#47785c] focus:ring-2 focus:ring-[#dceadf]"
      />
      <button
        type="submit"
        disabled={isSigningIn}
        className="h-9 rounded-md bg-[#2f6f4e] px-3 text-xs font-semibold text-white transition hover:bg-[#265c41] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSigningIn ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
