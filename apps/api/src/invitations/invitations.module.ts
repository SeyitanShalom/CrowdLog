import { Module } from "@nestjs/common";
import { InvitationEmailService } from "./invitation-email.service";

@Module({
  providers: [InvitationEmailService],
  exports: [InvitationEmailService],
})
export class InvitationsModule {}
