import type {
  AuthUser,
  CrowdLogEvent,
  EventMemberRole,
} from "@crowdlog/shared";

export function eventRoleForUser(
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

export function canManageEvent(
  event: CrowdLogEvent | null,
  user: AuthUser | null,
) {
  return eventRoleForUser(event, user) === "owner";
}
