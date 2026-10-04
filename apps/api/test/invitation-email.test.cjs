const assert = require("node:assert/strict");
const { createServer } = require("node:net");
const test = require("node:test");

const {
  InvitationEmailService,
  buildReviewerInvitationEmail,
} = require("../dist/invitations/invitation-email.service");

test("reviewer invitation email includes the event link and sign-in email", () => {
  const message = buildReviewerInvitationEmail(
    {
      eventId: "event_123",
      eventTitle: "Department Seminar",
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer User",
      invitedByEmail: "owner@example.com",
      invitedByName: "Owner User",
    },
    "https://crowdlog.example.com/app",
  );

  assert.equal(message.to, "reviewer@example.com");
  assert.equal(
    message.subject,
    "Invitation to review Department Seminar in CrowdLog",
  );
  assert.equal(
    message.inviteUrl,
    "https://crowdlog.example.com/app?eventId=event_123",
  );
  assert.match(message.text, /Owner User added you as a reviewer/);
  assert.match(message.text, /Sign in with this email address: reviewer@example.com/);
  assert.match(message.html, /href="https:\/\/crowdlog.example.com\/app\?eventId=event_123"/);
});

test("http provider posts a transactional invitation payload", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_HTTP_ENDPOINT:
      process.env.INVITATION_EMAIL_HTTP_ENDPOINT,
    INVITATION_EMAIL_HTTP_BEARER_TOKEN:
      process.env.INVITATION_EMAIL_HTTP_BEARER_TOKEN,
    CROWDLOG_APP_URL: process.env.CROWDLOG_APP_URL,
  };
  const previousFetch = global.fetch;
  const calls = [];

  process.env.INVITATION_EMAIL_PROVIDER = "http";
  process.env.INVITATION_EMAIL_HTTP_ENDPOINT =
    "https://email-provider.example/send";
  process.env.INVITATION_EMAIL_HTTP_BEARER_TOKEN = "test-token";
  process.env.CROWDLOG_APP_URL = "https://crowdlog.example.com";
  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 202,
      text: async () => "",
    };
  };

  try {
    const result = await new InvitationEmailService().sendReviewerInvitation({
      eventId: "event_123",
      eventTitle: "Department Seminar",
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer User",
      invitedByEmail: "owner@example.com",
      invitedByName: "Owner User",
    });

    assert.deepEqual(result, { provider: "http", sent: true, status: 202 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://email-provider.example/send");
    assert.equal(calls[0][1].method, "POST");
    assert.deepEqual(calls[0][1].headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });

    const payload = JSON.parse(calls[0][1].body);

    assert.equal(payload.type, "reviewer_invitation");
    assert.equal(payload.provider, "http");
    assert.equal(payload.to, "reviewer@example.com");
    assert.equal(payload.metadata.eventId, "event_123");
    assert.equal(payload.metadata.invitedByEmail, "owner@example.com");
    assert.equal(
      payload.inviteUrl,
      "https://crowdlog.example.com/?eventId=event_123",
    );
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
  }
});

test("http provider requires an endpoint", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_HTTP_ENDPOINT:
      process.env.INVITATION_EMAIL_HTTP_ENDPOINT,
  };

  process.env.INVITATION_EMAIL_PROVIDER = "http";
  delete process.env.INVITATION_EMAIL_HTTP_ENDPOINT;

  try {
    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /INVITATION_EMAIL_HTTP_ENDPOINT/,
    );
  } finally {
    restoreEnv(previousEnv);
  }
});

test("resend provider posts email payloads to the Resend API", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_RESEND_ENDPOINT:
      process.env.INVITATION_EMAIL_RESEND_ENDPOINT,
    INVITATION_EMAIL_FROM: process.env.INVITATION_EMAIL_FROM,
    INVITATION_EMAIL_REPLY_TO: process.env.INVITATION_EMAIL_REPLY_TO,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    CROWDLOG_APP_URL: process.env.CROWDLOG_APP_URL,
  };
  const previousFetch = global.fetch;
  const calls = [];

  process.env.INVITATION_EMAIL_PROVIDER = "resend";
  process.env.INVITATION_EMAIL_RESEND_ENDPOINT =
    "https://api.resend.test/emails";
  process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";
  process.env.INVITATION_EMAIL_REPLY_TO = "owner@example.com";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.CROWDLOG_APP_URL = "https://crowdlog.example.com/app";
  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "email_123" }),
    };
  };

  try {
    const result = await new InvitationEmailService().sendReviewerInvitation({
      eventId: "event_123",
      eventTitle: "Department Seminar",
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer User",
      invitedByEmail: "owner@example.com",
      invitedByName: "Owner User",
    });

    assert.deepEqual(result, {
      provider: "resend",
      sent: true,
      status: 200,
      id: "email_123",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://api.resend.test/emails");
    assert.equal(calls[0][1].method, "POST");
    assert.equal(calls[0][1].headers.Authorization, "Bearer re_test_key");
    assert.equal(calls[0][1].headers["Content-Type"], "application/json");
    assert.match(
      calls[0][1].headers["Idempotency-Key"],
      /^crowdlog-reviewer-invite-event-123-reviewer-example-com$/,
    );

    const payload = JSON.parse(calls[0][1].body);

    assert.deepEqual(payload.to, ["reviewer@example.com"]);
    assert.equal(payload.from, "CrowdLog <noreply@example.com>");
    assert.equal(payload.reply_to, "owner@example.com");
    assert.equal(
      payload.subject,
      "Invitation to review Department Seminar in CrowdLog",
    );
    assert.match(payload.html, /Open CrowdLog/);
    assert.match(payload.text, /https:\/\/crowdlog.example.com\/app\?eventId=event_123/);
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
  }
});

test("resend provider requires an API key and sender", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_FROM: process.env.INVITATION_EMAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.INVITATION_EMAIL_PROVIDER = "resend";
  delete process.env.RESEND_API_KEY;
  process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";

  try {
    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /RESEND_API_KEY/,
    );

    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.INVITATION_EMAIL_FROM;

    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /INVITATION_EMAIL_FROM/,
    );
  } finally {
    restoreEnv(previousEnv);
  }
});

test("postmark provider posts email payloads to the Postmark API", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_POSTMARK_ENDPOINT:
      process.env.INVITATION_EMAIL_POSTMARK_ENDPOINT,
    INVITATION_EMAIL_POSTMARK_MESSAGE_STREAM:
      process.env.INVITATION_EMAIL_POSTMARK_MESSAGE_STREAM,
    INVITATION_EMAIL_FROM: process.env.INVITATION_EMAIL_FROM,
    INVITATION_EMAIL_REPLY_TO: process.env.INVITATION_EMAIL_REPLY_TO,
    POSTMARK_SERVER_TOKEN: process.env.POSTMARK_SERVER_TOKEN,
    CROWDLOG_APP_URL: process.env.CROWDLOG_APP_URL,
  };
  const previousFetch = global.fetch;
  const calls = [];

  process.env.INVITATION_EMAIL_PROVIDER = "postmark";
  process.env.INVITATION_EMAIL_POSTMARK_ENDPOINT =
    "https://api.postmark.test/email";
  process.env.INVITATION_EMAIL_POSTMARK_MESSAGE_STREAM = "outbound";
  process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";
  process.env.INVITATION_EMAIL_REPLY_TO = "owner@example.com";
  process.env.POSTMARK_SERVER_TOKEN = "postmark_test_token";
  process.env.CROWDLOG_APP_URL = "https://crowdlog.example.com/app";
  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ MessageID: "pm_123" }),
    };
  };

  try {
    const result = await new InvitationEmailService().sendReviewerInvitation({
      eventId: "event_123",
      eventTitle: "Department Seminar",
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer User",
      invitedByEmail: "owner@example.com",
      invitedByName: "Owner User",
    });

    assert.deepEqual(result, {
      provider: "postmark",
      sent: true,
      status: 200,
      id: "pm_123",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://api.postmark.test/email");
    assert.equal(calls[0][1].method, "POST");
    assert.deepEqual(calls[0][1].headers, {
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": "postmark_test_token",
    });

    const payload = JSON.parse(calls[0][1].body);

    assert.equal(payload.From, "CrowdLog <noreply@example.com>");
    assert.equal(payload.To, "reviewer@example.com");
    assert.equal(payload.ReplyTo, "owner@example.com");
    assert.equal(payload.MessageStream, "outbound");
    assert.equal(
      payload.Subject,
      "Invitation to review Department Seminar in CrowdLog",
    );
    assert.match(payload.HtmlBody, /Open CrowdLog/);
    assert.match(payload.TextBody, /https:\/\/crowdlog.example.com\/app\?eventId=event_123/);
    assert.deepEqual(payload.Metadata, {
      crowdlog_invitation_type: "reviewer_invitation",
      crowdlog_event_id: "event_123",
      crowdlog_reviewer_email: "reviewer@example.com",
    });
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
  }
});

test("postmark provider requires a server token and sender", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_FROM: process.env.INVITATION_EMAIL_FROM,
    POSTMARK_SERVER_TOKEN: process.env.POSTMARK_SERVER_TOKEN,
  };

  process.env.INVITATION_EMAIL_PROVIDER = "postmark";
  delete process.env.POSTMARK_SERVER_TOKEN;
  process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";

  try {
    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /POSTMARK_SERVER_TOKEN/,
    );

    process.env.POSTMARK_SERVER_TOKEN = "postmark_test_token";
    delete process.env.INVITATION_EMAIL_FROM;

    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /INVITATION_EMAIL_FROM/,
    );
  } finally {
    restoreEnv(previousEnv);
  }
});

test("sendgrid provider posts email payloads to the SendGrid API", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_SENDGRID_ENDPOINT:
      process.env.INVITATION_EMAIL_SENDGRID_ENDPOINT,
    INVITATION_EMAIL_FROM: process.env.INVITATION_EMAIL_FROM,
    INVITATION_EMAIL_REPLY_TO: process.env.INVITATION_EMAIL_REPLY_TO,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    CROWDLOG_APP_URL: process.env.CROWDLOG_APP_URL,
  };
  const previousFetch = global.fetch;
  const calls = [];

  process.env.INVITATION_EMAIL_PROVIDER = "sendgrid";
  process.env.INVITATION_EMAIL_SENDGRID_ENDPOINT =
    "https://api.sendgrid.test/v3/mail/send";
  process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";
  process.env.INVITATION_EMAIL_REPLY_TO = "Owner <owner@example.com>";
  process.env.SENDGRID_API_KEY = "sendgrid_test_key";
  process.env.CROWDLOG_APP_URL = "https://crowdlog.example.com/app";
  global.fetch = async (...args) => {
    calls.push(args);

    return {
      ok: true,
      status: 202,
      headers: {
        get: (name) => (name.toLowerCase() === "x-message-id" ? "sg_123" : null),
      },
      text: async () => "",
    };
  };

  try {
    const result = await new InvitationEmailService().sendReviewerInvitation({
      eventId: "event_123",
      eventTitle: "Department Seminar",
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer User",
      invitedByEmail: "owner@example.com",
      invitedByName: "Owner User",
    });

    assert.deepEqual(result, {
      provider: "sendgrid",
      sent: true,
      status: 202,
      id: "sg_123",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://api.sendgrid.test/v3/mail/send");
    assert.equal(calls[0][1].method, "POST");
    assert.deepEqual(calls[0][1].headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer sendgrid_test_key",
    });

    const payload = JSON.parse(calls[0][1].body);

    assert.deepEqual(payload.from, {
      email: "noreply@example.com",
      name: "CrowdLog",
    });
    assert.deepEqual(payload.reply_to, {
      email: "owner@example.com",
      name: "Owner",
    });
    assert.equal(
      payload.subject,
      "Invitation to review Department Seminar in CrowdLog",
    );
    assert.deepEqual(payload.personalizations[0].to, [
      { email: "reviewer@example.com" },
    ]);
    assert.deepEqual(payload.personalizations[0].custom_args, {
      crowdlog_invitation_type: "reviewer_invitation",
      crowdlog_event_id: "event_123",
      crowdlog_reviewer_email: "reviewer@example.com",
    });
    assert.deepEqual(
      payload.content.map((part) => part.type),
      ["text/plain", "text/html"],
    );
    assert.match(payload.content[0].value, /https:\/\/crowdlog.example.com\/app\?eventId=event_123/);
    assert.match(payload.content[1].value, /Open CrowdLog/);
  } finally {
    restoreEnv(previousEnv);
    global.fetch = previousFetch;
  }
});

test("sendgrid provider requires an API key and sender", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_FROM: process.env.INVITATION_EMAIL_FROM,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  };

  process.env.INVITATION_EMAIL_PROVIDER = "sendgrid";
  delete process.env.SENDGRID_API_KEY;
  process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";

  try {
    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /SENDGRID_API_KEY/,
    );

    process.env.SENDGRID_API_KEY = "sendgrid_test_key";
    delete process.env.INVITATION_EMAIL_FROM;

    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /INVITATION_EMAIL_FROM/,
    );
  } finally {
    restoreEnv(previousEnv);
  }
});

test("smtp provider sends reviewer invitations through SMTP", async () => {
  const smtp = await startFakeSmtpServer();
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_SMTP_HOST: process.env.INVITATION_EMAIL_SMTP_HOST,
    INVITATION_EMAIL_SMTP_PORT: process.env.INVITATION_EMAIL_SMTP_PORT,
    INVITATION_EMAIL_SMTP_STARTTLS:
      process.env.INVITATION_EMAIL_SMTP_STARTTLS,
    INVITATION_EMAIL_SMTP_USERNAME:
      process.env.INVITATION_EMAIL_SMTP_USERNAME,
    INVITATION_EMAIL_SMTP_PASSWORD:
      process.env.INVITATION_EMAIL_SMTP_PASSWORD,
    INVITATION_EMAIL_FROM: process.env.INVITATION_EMAIL_FROM,
    INVITATION_EMAIL_REPLY_TO: process.env.INVITATION_EMAIL_REPLY_TO,
    CROWDLOG_APP_URL: process.env.CROWDLOG_APP_URL,
  };

  process.env.INVITATION_EMAIL_PROVIDER = "smtp";
  process.env.INVITATION_EMAIL_SMTP_HOST = "127.0.0.1";
  process.env.INVITATION_EMAIL_SMTP_PORT = String(smtp.port);
  process.env.INVITATION_EMAIL_SMTP_STARTTLS = "off";
  process.env.INVITATION_EMAIL_SMTP_USERNAME = "smtp-user";
  process.env.INVITATION_EMAIL_SMTP_PASSWORD = "smtp-pass";
  process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";
  process.env.INVITATION_EMAIL_REPLY_TO = "Owner <owner@example.com>";
  process.env.CROWDLOG_APP_URL = "https://crowdlog.example.com/app";

  try {
    const result = await new InvitationEmailService().sendReviewerInvitation({
      eventId: "event_123",
      eventTitle: "Department Seminar",
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer User",
      invitedByEmail: "owner@example.com",
      invitedByName: "Owner User",
    });

    assert.deepEqual(result, {
      provider: "smtp",
      sent: true,
      host: "127.0.0.1",
      port: smtp.port,
      tls: "none",
    });

    assert.match(smtp.commands[0], /^EHLO /);
    assert.match(smtp.commands[1], /^AUTH PLAIN /);
    assert.equal(
      Buffer.from(smtp.commands[1].split(" ")[2], "base64").toString("utf8"),
      "\u0000smtp-user\u0000smtp-pass",
    );
    assert.equal(smtp.commands[2], "MAIL FROM:<noreply@example.com>");
    assert.equal(smtp.commands[3], "RCPT TO:<reviewer@example.com>");
    assert.equal(smtp.commands[4], "DATA");
    assert.match(smtp.messages[0], /From: CrowdLog <noreply@example.com>/);
    assert.match(smtp.messages[0], /To: reviewer@example.com/);
    assert.match(smtp.messages[0], /Reply-To: Owner <owner@example.com>/);
    assert.match(
      smtp.messages[0],
      /Subject: Invitation to review Department Seminar in CrowdLog/,
    );
    assert.match(smtp.messages[0], /X-CrowdLog-Event-Id: event_123/);
    assert.match(smtp.messages[0], /Content-Type: multipart\/alternative/);
  } finally {
    restoreEnv(previousEnv);
    await smtp.close();
  }
});

test("smtp provider requires host, sender, and paired credentials", async () => {
  const previousEnv = {
    INVITATION_EMAIL_PROVIDER: process.env.INVITATION_EMAIL_PROVIDER,
    INVITATION_EMAIL_SMTP_HOST: process.env.INVITATION_EMAIL_SMTP_HOST,
    SMTP_HOST: process.env.SMTP_HOST,
    INVITATION_EMAIL_FROM: process.env.INVITATION_EMAIL_FROM,
    INVITATION_EMAIL_SMTP_USERNAME:
      process.env.INVITATION_EMAIL_SMTP_USERNAME,
    INVITATION_EMAIL_SMTP_PASSWORD:
      process.env.INVITATION_EMAIL_SMTP_PASSWORD,
  };

  process.env.INVITATION_EMAIL_PROVIDER = "smtp";
  delete process.env.INVITATION_EMAIL_SMTP_HOST;
  delete process.env.SMTP_HOST;
  process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";

  try {
    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /INVITATION_EMAIL_SMTP_HOST or SMTP_HOST/,
    );

    process.env.INVITATION_EMAIL_SMTP_HOST = "smtp.example.com";
    delete process.env.INVITATION_EMAIL_FROM;

    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /INVITATION_EMAIL_FROM/,
    );

    process.env.INVITATION_EMAIL_FROM = "CrowdLog <noreply@example.com>";
    process.env.INVITATION_EMAIL_SMTP_USERNAME = "smtp-user";
    delete process.env.INVITATION_EMAIL_SMTP_PASSWORD;

    await assert.rejects(
      () =>
        new InvitationEmailService().sendReviewerInvitation({
          eventId: "event_123",
          eventTitle: "Department Seminar",
          reviewerEmail: "reviewer@example.com",
        }),
      /INVITATION_EMAIL_SMTP_USERNAME and INVITATION_EMAIL_SMTP_PASSWORD/,
    );
  } finally {
    restoreEnv(previousEnv);
  }
});

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function startFakeSmtpServer() {
  const commands = [];
  const messages = [];
  const server = createServer((socket) => {
    let buffer = "";
    let dataMode = false;
    let message = "";

    socket.write("220 smtp.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      while (buffer.includes("\r\n")) {
        const lineEnd = buffer.indexOf("\r\n");
        const line = buffer.slice(0, lineEnd);

        buffer = buffer.slice(lineEnd + 2);

        if (dataMode) {
          if (line === ".") {
            messages.push(message);
            message = "";
            dataMode = false;
            socket.write("250 queued\r\n");
            continue;
          }

          message += `${line}\r\n`;
          continue;
        }

        commands.push(line);

        if (line.startsWith("EHLO")) {
          socket.write("250-smtp.test\r\n250 AUTH PLAIN\r\n");
        } else if (line.startsWith("AUTH PLAIN")) {
          socket.write("235 authenticated\r\n");
        } else if (line.startsWith("MAIL FROM:")) {
          socket.write("250 sender ok\r\n");
        } else if (line.startsWith("RCPT TO:")) {
          socket.write("250 recipient ok\r\n");
        } else if (line === "DATA") {
          dataMode = true;
          socket.write("354 end with dot\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });

  await new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", resolveServer);
  });

  return {
    commands,
    messages,
    port: server.address().port,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }

          resolveClose();
        });
      }),
  };
}
