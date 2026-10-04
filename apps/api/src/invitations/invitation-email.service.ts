import { Injectable } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { connect as connectSocket, Socket } from "node:net";
import { connect as connectTlsSocket, TLSSocket } from "node:tls";

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
  | "smtp"
  | "off";

type SmtpStartTlsMode = "auto" | "required" | "off";

type SmtpInvitationConfig = {
  host: string;
  port: number;
  secure: boolean;
  startTlsMode: SmtpStartTlsMode;
  username?: string;
  password?: string;
  from: string;
  replyTo?: string;
  heloName: string;
  rejectUnauthorized: boolean;
  timeoutMs: number;
};

type SmtpSendResult = {
  tls: "implicit" | "starttls" | "none";
};

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

    if (provider === "smtp") {
      return this.sendSmtpInvitation(input, message);
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

  private async sendSmtpInvitation(
    input: ReviewerInvitationEmailInput,
    message: ReviewerInvitationEmailMessage,
  ) {
    const config = smtpInvitationConfig();
    const smtpResult = await sendSmtpMail(config, {
      from: emailAddress(config.from),
      to: emailAddress(message.to),
      data: smtpMimeMessage(input, message, config),
    });

    return {
      provider: "smtp",
      sent: true,
      host: config.host,
      port: config.port,
      tls: smtpResult.tls,
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
    provider === "smtp" ||
    provider === "off"
  ) {
    return provider;
  }

  throw new Error(
    `Unsupported invitation email provider "${process.env.INVITATION_EMAIL_PROVIDER}". Use console, file, http, resend, postmark, sendgrid, smtp, or off.`,
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

function smtpInvitationConfig(): SmtpInvitationConfig {
  const host =
    process.env.INVITATION_EMAIL_SMTP_HOST?.trim() ||
    process.env.SMTP_HOST?.trim();
  const secure = booleanEnv(
    process.env.INVITATION_EMAIL_SMTP_SECURE ?? process.env.SMTP_SECURE,
    false,
  );
  const from = process.env.INVITATION_EMAIL_FROM?.trim();
  const username =
    process.env.INVITATION_EMAIL_SMTP_USERNAME?.trim() ||
    process.env.SMTP_USERNAME?.trim();
  const password =
    process.env.INVITATION_EMAIL_SMTP_PASSWORD?.trim() ||
    process.env.SMTP_PASSWORD?.trim();

  if (!host) {
    throw new Error(
      "INVITATION_EMAIL_SMTP_HOST or SMTP_HOST is required when INVITATION_EMAIL_PROVIDER is smtp.",
    );
  }

  if (!from) {
    throw new Error(
      "INVITATION_EMAIL_FROM is required when INVITATION_EMAIL_PROVIDER is smtp.",
    );
  }

  if ((username && !password) || (!username && password)) {
    throw new Error(
      "Both INVITATION_EMAIL_SMTP_USERNAME and INVITATION_EMAIL_SMTP_PASSWORD are required for SMTP authentication.",
    );
  }

  return {
    host,
    port: integerEnv(
      process.env.INVITATION_EMAIL_SMTP_PORT ?? process.env.SMTP_PORT,
      secure ? 465 : 587,
      1,
      65535,
      "INVITATION_EMAIL_SMTP_PORT",
    ),
    secure,
    startTlsMode: startTlsModeEnv(
      process.env.INVITATION_EMAIL_SMTP_STARTTLS ?? process.env.SMTP_STARTTLS,
    ),
    username,
    password,
    from,
    replyTo: process.env.INVITATION_EMAIL_REPLY_TO?.trim() || undefined,
    heloName:
      process.env.INVITATION_EMAIL_SMTP_HELO_NAME?.trim() ||
      process.env.SMTP_HELO_NAME?.trim() ||
      "crowdlog.local",
    rejectUnauthorized: booleanEnv(
      process.env.INVITATION_EMAIL_SMTP_REJECT_UNAUTHORIZED ??
        process.env.SMTP_REJECT_UNAUTHORIZED,
      true,
    ),
    timeoutMs: integerEnv(
      process.env.INVITATION_EMAIL_SMTP_TIMEOUT_MS ?? process.env.SMTP_TIMEOUT_MS,
      30000,
      1000,
      120000,
      "INVITATION_EMAIL_SMTP_TIMEOUT_MS",
    ),
  };
}

async function sendSmtpMail(
  config: SmtpInvitationConfig,
  email: { from: string; to: string; data: string },
): Promise<SmtpSendResult> {
  const stream = await openSmtpStream(config);
  const connection = new SmtpConnection(stream, config.timeoutMs);
  let tls: SmtpSendResult["tls"] = config.secure ? "implicit" : "none";

  try {
    await connection.readResponse([220]);
    let ehloResponse = await sendSmtpEhlo(connection, config.heloName);

    if (!config.secure) {
      const supportsStartTls = smtpResponseHasCapability(
        ehloResponse.lines,
        "STARTTLS",
      );

      if (config.startTlsMode === "required" && !supportsStartTls) {
        throw new Error("SMTP server does not advertise STARTTLS.");
      }

      if (config.startTlsMode !== "off" && supportsStartTls) {
        await connection.sendCommand("STARTTLS", [220]);
        await connection.upgradeToTls(config);
        tls = "starttls";
        ehloResponse = await sendSmtpEhlo(connection, config.heloName);
      }
    }

    if (config.username && config.password) {
      const token = Buffer.from(
        `\u0000${config.username}\u0000${config.password}`,
        "utf8",
      ).toString("base64");

      await connection.sendCommand(`AUTH PLAIN ${token}`, [235]);
    }

    await connection.sendCommand(`MAIL FROM:<${email.from}>`, [250]);
    await connection.sendCommand(`RCPT TO:<${email.to}>`, [250, 251]);
    await connection.sendCommand("DATA", [354]);
    await connection.writeData(email.data);

    try {
      await connection.sendCommand("QUIT", [221]);
    } catch {
      // Delivery already succeeded after DATA; a noisy QUIT should not fail it.
    }

    return { tls };
  } finally {
    connection.close();
  }
}

function smtpMimeMessage(
  input: ReviewerInvitationEmailInput,
  message: ReviewerInvitationEmailMessage,
  config: SmtpInvitationConfig,
) {
  const boundary = `crowdlog-${randomUUID()}`;
  const headers = [
    `From: ${sanitizeHeaderValue(config.from)}`,
    `To: ${sanitizeHeaderValue(message.to)}`,
    ...(config.replyTo
      ? [`Reply-To: ${sanitizeHeaderValue(config.replyTo)}`]
      : []),
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Message-ID: <${randomUUID()}@crowdlog.local>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `X-CrowdLog-Invitation-Type: reviewer_invitation`,
    `X-CrowdLog-Event-Id: ${sanitizeHeaderValue(input.eventId)}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const textPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(message.text),
  ];
  const htmlPart = [
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(message.html),
  ];

  return [
    ...headers,
    "",
    ...textPart,
    ...htmlPart,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function openSmtpStream(config: SmtpInvitationConfig) {
  const connectOptions = {
    host: config.host,
    port: config.port,
  };

  return new Promise<Socket | TLSSocket>((resolveStream, reject) => {
    const stream = config.secure
      ? connectTlsSocket({
          ...connectOptions,
          servername: config.host,
          rejectUnauthorized: config.rejectUnauthorized,
        })
      : connectSocket(connectOptions);
    const timeout = setTimeout(() => {
      stream.destroy(new Error("SMTP connection timed out."));
    }, config.timeoutMs);
    const onError = (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    };
    const onConnect = () => {
      clearTimeout(timeout);
      stream.off("error", onError);
      resolveStream(stream);
    };

    stream.once("error", onError);
    stream.once(config.secure ? "secureConnect" : "connect", onConnect);
  });
}

async function sendSmtpEhlo(connection: SmtpConnection, heloName: string) {
  try {
    return await connection.sendCommand(
      `EHLO ${sanitizeSmtpCommandArg(heloName)}`,
      [250],
    );
  } catch {
    return connection.sendCommand(`HELO ${sanitizeSmtpCommandArg(heloName)}`, [
      250,
    ]);
  }
}

function smtpResponseHasCapability(lines: string[], capability: string) {
  const expected = capability.toUpperCase();

  return lines.some((line) =>
    line
      .replace(/^\d{3}[- ]/, "")
      .trim()
      .toUpperCase()
      .startsWith(expected),
  );
}

class SmtpConnection {
  private stream: Socket | TLSSocket;
  private buffer = "";
  private readonly queuedLines: string[] = [];
  private readonly lineWaiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];

  constructor(stream: Socket | TLSSocket, private readonly timeoutMs: number) {
    this.stream = stream;
    this.attach(stream);
  }

  async readResponse(expectedCodes: number[]) {
    const lines: string[] = [];
    const firstLine = await this.readLine();
    const code = smtpResponseCode(firstLine);

    lines.push(firstLine);

    while (firstLine.startsWith(`${code}-`) || lines.at(-1)?.startsWith(`${code}-`)) {
      if (!lines.at(-1)?.startsWith(`${code}-`)) {
        break;
      }

      lines.push(await this.readLine());
    }

    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP server returned ${code}: ${lines.join(" ")}`);
    }

    return { code, lines };
  }

  async sendCommand(command: string, expectedCodes: number[]) {
    await this.writeRaw(`${command}\r\n`);
    return this.readResponse(expectedCodes);
  }

  async writeData(data: string) {
    const normalized = dotStuffSmtpData(data);

    await this.writeRaw(`${normalized}\r\n.\r\n`);
    return this.readResponse([250]);
  }

  async upgradeToTls(config: SmtpInvitationConfig) {
    const rawStream = this.stream;

    this.detach(rawStream);

    const tlsStream = await new Promise<TLSSocket>((resolveStream, reject) => {
      const upgraded = connectTlsSocket({
        socket: rawStream,
        servername: config.host,
        rejectUnauthorized: config.rejectUnauthorized,
      });
      const timeout = setTimeout(() => {
        upgraded.destroy(new Error("SMTP STARTTLS handshake timed out."));
      }, config.timeoutMs);
      const onError = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };
      const onSecureConnect = () => {
        clearTimeout(timeout);
        upgraded.off("error", onError);
        resolveStream(upgraded);
      };

      upgraded.once("error", onError);
      upgraded.once("secureConnect", onSecureConnect);
    });

    this.stream = tlsStream;
    this.buffer = "";
    this.attach(tlsStream);
  }

  close() {
    for (const waiter of this.lineWaiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("SMTP connection closed."));
    }

    this.detach(this.stream);
    this.stream.end();
  }

  private attach(stream: Socket | TLSSocket) {
    stream.setEncoding("utf8");
    stream.on("data", this.handleData);
    stream.on("error", this.handleError);
    stream.on("end", this.handleEnd);
  }

  private detach(stream: Socket | TLSSocket) {
    stream.off("data", this.handleData);
    stream.off("error", this.handleError);
    stream.off("end", this.handleEnd);
  }

  private readonly handleData = (chunk: string | Buffer) => {
    this.buffer += chunk.toString();

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");

      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.pushLine(line);
    }
  };

  private readonly handleError = (error: Error) => {
    this.rejectPending(error);
  };

  private readonly handleEnd = () => {
    this.rejectPending(new Error("SMTP connection ended unexpectedly."));
  };

  private readLine() {
    if (this.queuedLines.length > 0) {
      return Promise.resolve(this.queuedLines.shift() as string);
    }

    return new Promise<string>((resolveLine, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("SMTP response timed out."));
      }, this.timeoutMs);

      this.lineWaiters.push({ resolve: resolveLine, reject, timeout });
    });
  }

  private pushLine(line: string) {
    const waiter = this.lineWaiters.shift();

    if (!waiter) {
      this.queuedLines.push(line);
      return;
    }

    clearTimeout(waiter.timeout);
    waiter.resolve(line);
  }

  private rejectPending(error: Error) {
    for (const waiter of this.lineWaiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  }

  private writeRaw(value: string) {
    return new Promise<void>((resolveWrite, reject) => {
      this.stream.write(value, "utf8", (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolveWrite();
      });
    });
  }
}

function smtpResponseCode(line: string) {
  const code = Number(line.slice(0, 3));

  if (!Number.isInteger(code)) {
    throw new Error(`Invalid SMTP response: ${line}`);
  }

  return code;
}

function dotStuffSmtpData(data: string) {
  return data
    .replace(/\r?\n/g, "\r\n")
    .replace(/^\./gm, "..")
    .replace(/\r\n$/g, "");
}

function emailAddress(value: string) {
  const trimmed = value.trim();
  const emailWithName = /^(.*?)<([^<>\s]+@[^<>\s]+)>$/.exec(trimmed);
  const email = emailWithName ? emailWithName[2].trim() : trimmed;

  if (!/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(email)) {
    throw new Error(`Invalid email address for SMTP delivery: ${trimmed}`);
  }

  return email;
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function sanitizeSmtpCommandArg(value: string) {
  return value.replace(/[\r\n\s]+/g, "-").trim() || "crowdlog.local";
}

function encodeHeaderValue(value: string) {
  const sanitized = sanitizeHeaderValue(value);

  if (/^[\x20-\x7e]*$/.test(sanitized)) {
    return sanitized;
  }

  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
}

function base64Body(value: string) {
  return (
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || ""
  );
}

function integerEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
) {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }

  return parsed;
}

function booleanEnv(value: string | undefined, fallback: boolean) {
  if (!value?.trim()) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Expected a boolean environment value, received "${value}".`);
}

function startTlsModeEnv(value: string | undefined): SmtpStartTlsMode {
  if (!value?.trim()) {
    return "auto";
  }

  const normalized = value.trim().toLowerCase();

  if (["auto", "required", "off"].includes(normalized)) {
    return normalized as SmtpStartTlsMode;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return "required";
  }

  if (["0", "false", "no"].includes(normalized)) {
    return "off";
  }

  throw new Error(
    'INVITATION_EMAIL_SMTP_STARTTLS must be "auto", "required", or "off".',
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
