import { AttendanceRecordStatus } from "@prisma/client";
import type { ApiRecordStatus } from "./dto/create-attendance-records.dto";

const toPrismaStatusMap: Record<ApiRecordStatus, AttendanceRecordStatus> = {
  draft: AttendanceRecordStatus.DRAFT,
  needs_review: AttendanceRecordStatus.NEEDS_REVIEW,
  approved: AttendanceRecordStatus.APPROVED,
  rejected: AttendanceRecordStatus.REJECTED,
};

const fromPrismaStatusMap: Record<AttendanceRecordStatus, ApiRecordStatus> = {
  DRAFT: "draft",
  NEEDS_REVIEW: "needs_review",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export function toPrismaRecordStatus(status: ApiRecordStatus) {
  return toPrismaStatusMap[status];
}

export function fromPrismaRecordStatus(status: AttendanceRecordStatus) {
  return fromPrismaStatusMap[status];
}
