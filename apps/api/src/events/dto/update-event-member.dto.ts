import { IsIn } from "class-validator";

export class UpdateEventMemberDto {
  @IsIn(["owner", "reviewer"])
  role: "owner" | "reviewer";
}
