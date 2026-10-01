import { Injectable } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type ReviewerInvitationEmailInput = {
  eventId: string;
  eventTitle: string;
  reviewerEmail: string;
  reviewerName?: string | null;
  invitedByEmail?: string | null;
  invitedByName?: string | null;
};

export type ReviewerInvitationEmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  inviteUrl: string;
};

type InvitationEmailProvider =
  | "console"
  | "file"
  | "http"
  | "resend"
  | "postmark"
  | "sendgrid"
  | "off";

@Injectable()
export class InvitationEmailService {
  async sendReviewerInvitation(input: ReviewerInvitationEmailInput) {
    const provider = invitationEmailProvider();

    if (provider === "off") {
      return { provider, sent: false };
    }

    const message = buildReviewerInvitationEmail(
      input,
      appBaseUrlWithFallback(),
    );

    if (provider === "http") {
      return this.sendHttpInvitation(input, message);
    }

    if (provider === "resend") {
      return this.sendResendInvitation(input, message);
    }

    if (provider === "postmark") {
      return this.sendPostmarkInvitation(input, message);
    }

    if (provider === "sendgrid") {
      return this.sendSendgridInvitation(input, message);
    }

    if (provider === "file") {
      const outboxDir = resolve(
        process.cwd(),
        process.env.INVITATION_EMAIL_OUTBOX_DIR || "invitation-outbox",
      );
      const fileName = `${Date.now()}-${safeFileSegment(input.reviewerEmail)}-${randomUUID()}.json`;

      await mkdir(outboxDir, { recursive: true });
      await writeFile(
        resolve(outboxDir, fileName),
        `${JSON.stringify(invitationEnvelope(input, message, provider), null, 2)}\n`,
        "utf8",
      );

      return { provider, sent: true };
    }

    console.info(
      [
        "[CrowdLog invitation email]",
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        message.text,
      ].join("\n"),
    );

    return { provider, sent: true };
  }

  private async sendHttpInvitation(
    input: ReviewerInvitationEmailInput,
    message: ReviewerInvitationEmailMessage,
  ) {
    const endpoint = process.env.INVITATION_EMAIL_HTTP_ENDPOINT?.trim();

    if (!endpoint) {
      throw new Error(
        "INVITATION_EMAIL_HTTP_ENDPOINT is required when INVITATION_EMAIL_PROVIDER is http.",
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const bearerToken = process.env.INVITATION_EMAIL_HTTP_BEARER_TOKEN?.trim();

    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(invitationEnvelope(input, message, "http")),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body ? ` ${body.slice(0, 300)}` : "";

      throw new Error(
        `Invitation HTTP provider failed with status ${response.status}.${detail}`,
      );
    }

    return { provider: "http", sent: true, status: response.status };
  }

  private async sendResendInvitation(
    input: ReviewerInvitationEmailInput,
    message: ReviewerInvitationEmailMessage,
  ) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.INVITATION_EMAIL_FROM?.trim();

    if (!apiKey) {
      throw new Error(
        "RESEND_API_KEY is required when INVITATION_EMAIL_PROVIDER is resend.",
      );
    }

    if (!from) {
      throw new Error(
        "INVITATION_EMAIL_FROM is required when INVITATION_EMAIL_PROVIDER is resend.",
      );
    }

    const replyTo = process.env.INVITATION_EMAIL_REPLY_TO?.trim();
    const endpoint =
      process.env.INVITATION_EMAIL_RESEND_ENDPOINT?.trim() ||
      "https://api.resend.com/emails";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Idempotency-Key": resendIdempotencyKey(input),
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      const detail = bodyText ? ` ${bodyText.slice(0, 300)}` : "";

      throw new Error(
        `Resend invitation provider failed with status ${response.status}.${detail}`,
      );
    }

    return {
      provider: "resend",
      sent: true,
      status: response.status,
      id: readJsonStringProperty(bodyText, "id"),
    };
  }

  private async sendPostmarkInvitation(
    input: ReviewerInvitationEmailInput,
    message: ReviewerInvitationEmailMessage,
  ) {
    const serverToken = process.env.POSTMARK_SERVER_TOKEN?.trim();
    const from = process.env.INVITATION_EMAIL_FROM?.trim();

    if (!serverToken) {
      throw new Error(
        "POSTMARK_SERVER_TOKEN is required when INVITATION_EMAIL_PROVIDER is postmark.",
      );
    }

    if (!from) {
      throw new Error(
        "INVITATION_EMAIL_FROM is required when INVITATION_EMAIL_PROVIDER is postmark.",
      );
    }

    const replyTo = process.env.INVITATION_EMAIL_REPLY_TO?.trim();
    const messageStream =
      process.env.INVITATION_EMAIL_POSTMARK_MESSAGE_STREAM?.trim();
    const endpoint =
      process.env.INVITATION_EMAIL_POSTMARK_ENDPOINT?.trim() ||
      "https://api.postmarkapp.com/email";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": serverToken,
      },
      body: JSON.stringify({
        From: from,
        To: message.to,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        ...(replyTo ? { ReplyTo: replyTo } : {}),
        ...(messageStream ? { MessageStream: messageStream } : {}),
        Metadata: {
          crowdlog_invitation_type: "reviewer_invitation",
          crowdlog_event_id: input.eventId,
          crowdlog_reviewer_email: input.reviewerEmail,
        },
      }),
    });

    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      const detail = bodyText ? ` ${bodyText.slice(0, 300)}` : "";

      throw new Error(
        `Postmark invitation provider failed with status ${response.status}.${detail}`,
      );
    }

    return {
      provider: "postmark",
      sent: true,
      status: response.status,
      id: readJsonStringProperty(bodyText, "MessageID"),
    };
  }

  private async sendSendgridInvitation(
    input: ReviewerInvitationEmailInput,
    message: ReviewerInvitationEmailMessage,
  ) {
    const apiKey = process.env.SENDGRID_API_KEY?.trim();
    const from = process.env.INVITATION_EMAIL_FROM?.trim();

    if (!apiKey) {
      throw new Error(
        "SENDGRID_API_KEY is required when INVITATION_EMAIL_PROVIDER is sendgrid.",
      );
    }

    if (!from) {
      throw new Error(
        "INVITATION_EMAIL_FROM is required when INVITATION_EMAIL_PROVIDER is sendgrid.",
      );
    }

    const replyTo = process.env.INVITATION_EMAIL_REPLY_TO?.trim();
    const endpoint =
      process.env.INVITATION_EMAIL_SENDGRID_ENDPOINT?.trim() ||
      "https://api.sendgrid.com/v3/mail/send";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [sendgridEmailAddress(message.to)],
            custom_args: {
              crowdlog_invitation_type: "reviewer_invitation",
              crowdlog_event_id: input.eventId,
              crowdlog_reviewer_email: input.reviewerEmail,
            },
          },
        ],
        from: sendgridEmailAddress(from),
        ...(replyTo ? { reply_to: sendgridEmailAddress(replyTo) } : {}),
        subject: message.subject,
        content: [
          {
            type: "text/plain",
            value: message.text,
          },
          {
            type: "text/html",
            value: message.html,
          },
        ],
      }),
    });

    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      const detail = bodyText ? ` ${bodyText.slice(0, 300)}` : "";

      throw new Error(
        `SendGrid invitation provider failed with status ${response.status}.${detail}`,
      );
    }

    return {
      provider: "sendgrid",
      sent: true,
      status: response.status,
      id: response.headers.get("x-message-id") || null,
    };
  }
}

export function buildReviewerInvitationEmail(
  input: ReviewerInvitationEmailInput,
  appBaseUrl: string,
): ReviewerInvitationEmailMessage {
  const reviewerName = input.reviewerName?.trim() || input.reviewerEmail;
  const invitedBy =
    input.invitedByName?.trim() ||
    input.invitedByEmail?.trim() ||
    "A CrowdLog event owner";
  const inviteUrl = invitationUrl(appBaseUrl, input.eventId);
  const eventTitle = input.eventTitle.trim() || "this CrowdLog event";
  const subject = `Invitation to review ${eventTitle} in CrowdLog`;
  const text = [
    `Hello ${reviewerName},`,
    "",
    `${invitedBy} added you as a reviewer for "${eventTitle}".`,
    "",
    `Open CrowdLog: ${inviteUrl}`,
    `Sign in with this email address: ${input.reviewerEmail}`,
    "",
    "You can review extracted attendance rows, correct OCR values, and approve or reject records for this event.",
  ].join("\n");
  const html = [
    `<p>Hello ${escapeHtml(reviewerName)},</p>`,
    `<p>${escapeHtml(invitedBy)} added you as a reviewer for <strong>${escapeHtml(eventTitle)}</strong>.</p>`,
    `<p><a href="${escapeHtml(inviteUrl)}">Open CrowdLog</a></p>`,
    `<p>Sign in with this email address: <strong>${escapeHtml(input.reviewerEmail)}</strong></p>`,
    "<p>You can review extracted attendance rows, correct OCR values, and approve or reject records for this event.</p>",
  ].join("");

  return {
    to: input.reviewerEmail,
    subject,
    text,
    html,
    inviteUrl,
  };
}

function invitationEmailProvider(): InvitationEmailProvider {
  const provider = process.env.INVITATION_EMAIL_PROVIDER?.trim().toLowerCase();

  if (!provider || provider === "console") {
    return "console";
  }

  if (
    provider === "file" ||
    provider === "http" ||
    provider === "resend" ||
    provider === "postmark" ||
    provider === "sendgrid" ||
    provider === "off"
  ) {
    return provider;
  }

  throw new Error(
    `Unsupported invitation email provider "${process.env.INVITATION_EMAIL_PROVIDER}". Use console, file, http, resend, postmark, sendgrid, or off.`,
  );
}

function invitationEnvelope(
  input: ReviewerInvitationEmailInput,
  message: ReviewerInvitationEmailMessage,
  provider: InvitationEmailProvider,
) {
  return {
    id: randomUUID(),
    type: "reviewer_invitation",
    queuedAt: new Date().toISOString(),
    provider,
    ...message,
    metadata: {
      eventId: input.eventId,
      eventTitle: input.eventTitle,
      reviewerEmail: input.reviewerEmail,
      reviewerName: input.reviewerName ?? null,
      invitedByEmail: input.invitedByEmail ?? null,
      invitedByName: input.invitedByName ?? null,
    },
  };
}

function appBaseUrlWithFallback() {
  return (
    process.env.CROWDLOG_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    "http://localhost:3000"
  );
}

function invitationUrl(appBaseUrl: string, eventId: string) {
  try {
    const url = new URL(appBaseUrl);

    url.searchParams.set("eventId", eventId);
    return url.toString();
  } catch {
    const separator = appBaseUrl.includes("?") ? "&" : "?";

    return `${appBaseUrl}${separator}eventId=${encodeURIComponent(eventId)}`;
  }
}

function safeFileSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "reviewer"
  );
}

function resendIdempotencyKey(input: ReviewerInvitationEmailInput) {
  const email = safeFileSegment(input.reviewerEmail);
  const eventId = safeFileSegment(input.eventId);

  return `crowdlog-reviewer-invite-${eventId}-${email}`.slice(0, 256);
}

function sendgridEmailAddress(value: string) {
  const trimmed = value.trim();
  const emailWithName = /^(.*?)<([^<>\s]+@[^<>\s]+)>$/.exec(trimmed);

  if (!emailWithName) {
    return { email: trimmed };
  }

  const name = emailWithName[1].trim().replace(/^"|"$/g, "");
  const email = emailWithName[2].trim();

  return name ? { email, name } : { email };
}

function readJsonStringProperty(bodyText: string, key: string) {
  if (!bodyText) {
    return null;
  }

  try {
    const value = (JSON.parse(bodyText) as Record<string, unknown>)[key];

    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
