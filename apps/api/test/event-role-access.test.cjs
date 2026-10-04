const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} = require("@nestjs/common");
const {
  AttendanceRecordStatus,
  EventMemberRole,
} = require("@prisma/client");
const { EventsService } = require("../dist/events/events.service");
const { RecordsService } = require("../dist/records/records.service");

function mockFn(implementation) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return implementation?.(...args);
  };

  fn.calls = calls;
  return fn;
}

const now = new Date("2026-09-28T00:00:00.000Z");

function permissionEvent(overrides = {}) {
  return {
    id: "event_1",
    ownerId: "user_owner",
    members: [
      {
        id: "member_owner",
        eventId: "event_1",
        userId: "user_owner",
        role: EventMemberRole.OWNER,
      },
    ],
    ...overrides,
  };
}

function eventResponse(overrides = {}) {
  return {
    id: "event_1",
    title: "Seminar",
    description: null,
    eventDate: null,
    ownerId: "user_owner",
    createdAt: now,
    updatedAt: now,
    members: [
      {
        id: "member_owner",
        eventId: "event_1",
        userId: "user_owner",
        role: EventMemberRole.OWNER,
        createdAt: now,
        updatedAt: now,
        user: {
          id: "user_owner",
          email: "owner@example.com",
          name: "Owner",
        },
      },
      {
        id: "member_reviewer",
        eventId: "event_1",
        userId: "user_reviewer",
        role: EventMemberRole.REVIEWER,
        createdAt: now,
        updatedAt: now,
        user: {
          id: "user_reviewer",
          email: "reviewer@example.com",
          name: "Reviewer",
        },
      },
    ],
    templates: [
      {
        id: "template_1",
        eventId: "event_1",
        name: "Default attendance template",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
        fields: [],
      },
    ],
    ...overrides,
  };
}

function templateField() {
  return {
    id: "field_name",
    templateId: "template_1",
    label: "Name",
    key: "name",
    type: "TEXT",
    required: true,
    sortOrder: 1,
    aliases: [],
    options: [],
    createdAt: now,
    updatedAt: now,
  };
}

function emailTemplateField() {
  return {
    id: "field_email",
    templateId: "template_1",
    label: "Email",
    key: "email",
    type: "EMAIL",
    required: false,
    sortOrder: 2,
    aliases: [],
    options: [],
    createdAt: now,
    updatedAt: now,
  };
}

function recordResponse(status = AttendanceRecordStatus.APPROVED) {
  return {
    id: "record_1",
    eventId: "event_1",
    documentId: null,
    rowNumber: 1,
    dataJson: { name: "Ada" },
    confidenceScore: 0.9,
    status,
    document: null,
    values: [],
    createdAt: now,
    updatedAt: now,
  };
}

function readStoredZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;

  while (
    offset + 4 <= buffer.length &&
    buffer.readUInt32LE(offset) === 0x04034b50
  ) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    const fileName = buffer.toString("utf8", fileNameStart, fileNameEnd);

    entries.set(fileName, buffer.subarray(dataStart, dataEnd).toString("utf8"));
    offset = dataEnd;
  }

  return entries;
}

test("owners can add reviewers and receive updated member roles", async () => {
  let eventReadCount = 0;
  const prisma = {
    event: {
      findUnique: mockFn(async () => {
        eventReadCount += 1;
        return eventReadCount === 1 ? permissionEvent() : eventResponse();
      }),
    },
    user: {
      upsert: mockFn(async (input) => ({
        id: "user_reviewer",
        email: input.where.email,
        name: input.create.name,
      })),
    },
    eventMembership: {
      findUnique: mockFn(async () => null),
      create: mockFn(async (input) => ({
        id: "member_reviewer",
        ...input.data,
      })),
    },
  };
  const service = new EventsService(prisma);

  const response = await service.addReviewer(
    "event_1",
    {
      email: " REVIEWER@Example.COM ",
      name: " Reviewer ",
    },
    "user_owner",
  );

  assert.deepEqual(prisma.user.upsert.calls[0][0].where, {
    email: "reviewer@example.com",
  });
  assert.equal(
    prisma.eventMembership.create.calls[0][0].data.role,
    EventMemberRole.REVIEWER,
  );
  assert.deepEqual(
    response.members.map((member) => member.role),
    ["owner", "reviewer"],
  );
});

test("adding a new reviewer queues an invitation email", async () => {
  let eventReadCount = 0;
  const prisma = {
    event: {
      findUnique: mockFn(async () => {
        eventReadCount += 1;
        return eventReadCount === 1
          ? permissionEvent({ title: "Seminar Attendance" })
          : eventResponse();
      }),
    },
    user: {
      upsert: mockFn(async (input) => ({
        id: "user_reviewer",
        email: input.where.email,
        name: input.create.name,
      })),
      findUnique: mockFn(async () => ({
        email: "owner@example.com",
        name: "Owner User",
      })),
    },
    eventMembership: {
      findUnique: mockFn(async () => null),
      create: mockFn(async (input) => ({
        id: "member_reviewer",
        ...input.data,
      })),
    },
  };
  const invitationEmailService = {
    sendReviewerInvitation: mockFn(async () => ({ provider: "console" })),
  };
  const service = new EventsService(prisma, invitationEmailService);

  await service.addReviewer(
    "event_1",
    {
      email: " reviewer@example.com ",
      name: " Reviewer ",
    },
    "user_owner",
  );

  assert.equal(invitationEmailService.sendReviewerInvitation.calls.length, 1);
  assert.deepEqual(invitationEmailService.sendReviewerInvitation.calls[0][0], {
    eventId: "event_1",
    eventTitle: "Seminar Attendance",
    reviewerEmail: "reviewer@example.com",
    reviewerName: "Reviewer",
    invitedByEmail: "owner@example.com",
    invitedByName: "Owner User",
  });
});

test("adding an existing reviewer does not resend an invitation email", async () => {
  let eventReadCount = 0;
  const prisma = {
    event: {
      findUnique: mockFn(async () => {
        eventReadCount += 1;
        return eventReadCount === 1 ? permissionEvent() : eventResponse();
      }),
    },
    user: {
      upsert: mockFn(async (input) => ({
        id: "user_reviewer",
        email: input.where.email,
        name: input.create.name,
      })),
      findUnique: mockFn(),
    },
    eventMembership: {
      findUnique: mockFn(async () => ({
        id: "member_reviewer",
        eventId: "event_1",
        userId: "user_reviewer",
        role: EventMemberRole.REVIEWER,
      })),
      create: mockFn(),
    },
  };
  const invitationEmailService = {
    sendReviewerInvitation: mockFn(),
  };
  const service = new EventsService(prisma, invitationEmailService);

  await service.addReviewer(
    "event_1",
    { email: "reviewer@example.com" },
    "user_owner",
  );

  assert.equal(prisma.eventMembership.create.calls.length, 0);
  assert.equal(prisma.user.findUnique.calls.length, 0);
  assert.equal(invitationEmailService.sendReviewerInvitation.calls.length, 0);
});

test("reviewer creation succeeds when invitation delivery fails", async () => {
  let eventReadCount = 0;
  const previousWarn = console.warn;
  const warnings = [];
  const prisma = {
    event: {
      findUnique: mockFn(async () => {
        eventReadCount += 1;
        return eventReadCount === 1 ? permissionEvent() : eventResponse();
      }),
    },
    user: {
      upsert: mockFn(async (input) => ({
        id: "user_reviewer",
        email: input.where.email,
        name: input.create.name,
      })),
      findUnique: mockFn(async () => ({
        email: "owner@example.com",
        name: "Owner User",
      })),
    },
    eventMembership: {
      findUnique: mockFn(async () => null),
      create: mockFn(async (input) => ({
        id: "member_reviewer",
        ...input.data,
      })),
    },
  };
  const invitationEmailService = {
    sendReviewerInvitation: mockFn(async () => {
      throw new Error("provider unavailable");
    }),
  };
  const service = new EventsService(prisma, invitationEmailService);

  console.warn = (...args) => warnings.push(args);

  try {
    const response = await service.addReviewer(
      "event_1",
      { email: "reviewer@example.com" },
      "user_owner",
    );

    assert.equal(prisma.eventMembership.create.calls.length, 1);
    assert.equal(invitationEmailService.sendReviewerInvitation.calls.length, 1);
    assert.deepEqual(
      response.members.map((member) => member.role),
      ["owner", "reviewer"],
    );
    assert.match(warnings[0][0], /Could not queue reviewer invitation/);
  } finally {
    console.warn = previousWarn;
  }
});

test("reviewers cannot add event members", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () =>
        permissionEvent({
          members: [
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.REVIEWER,
            },
          ],
        }),
      ),
    },
    user: {
      upsert: mockFn(),
    },
  };
  const service = new EventsService(prisma);

  await assert.rejects(
    () =>
      service.addReviewer(
        "event_1",
        { email: "new-reviewer@example.com" },
        "user_reviewer",
      ),
    ForbiddenException,
  );
  assert.equal(prisma.user.upsert.calls.length, 0);
});

test("owners can promote reviewers to event owners", async () => {
  let eventReadCount = 0;
  const prisma = {
    event: {
      findUnique: mockFn(async () => {
        eventReadCount += 1;

        if (eventReadCount === 1) {
          return permissionEvent({
            ownerId: null,
            members: [
              {
                id: "member_owner",
                eventId: "event_1",
                userId: "user_owner",
                role: EventMemberRole.OWNER,
              },
              {
                id: "member_reviewer",
                eventId: "event_1",
                userId: "user_reviewer",
                role: EventMemberRole.REVIEWER,
              },
            ],
          });
        }

        return eventResponse({
          ownerId: "user_reviewer",
          members: [
            {
              id: "member_owner",
              eventId: "event_1",
              userId: "user_owner",
              role: EventMemberRole.OWNER,
              createdAt: now,
              updatedAt: now,
              user: {
                id: "user_owner",
                email: "owner@example.com",
                name: "Owner",
              },
            },
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.OWNER,
              createdAt: now,
              updatedAt: now,
              user: {
                id: "user_reviewer",
                email: "reviewer@example.com",
                name: "Reviewer",
              },
            },
          ],
        });
      }),
      update: mockFn(async () => null),
    },
    eventMembership: {
      update: mockFn(async () => null),
    },
  };
  const service = new EventsService(prisma);

  const response = await service.updateMemberRole(
    "event_1",
    "member_reviewer",
    { role: "owner" },
    "user_owner",
  );

  assert.deepEqual(prisma.eventMembership.update.calls[0][0], {
    where: { id: "member_reviewer" },
    data: { role: EventMemberRole.OWNER },
  });
  assert.deepEqual(prisma.event.update.calls[0][0], {
    where: { id: "event_1" },
    data: { ownerId: "user_reviewer" },
  });
  assert.deepEqual(
    response.members.map((member) => member.role),
    ["owner", "owner"],
  );
});

test("owners cannot demote the last event owner", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () => permissionEvent()),
    },
    eventMembership: {
      update: mockFn(),
    },
  };
  const service = new EventsService(prisma);

  await assert.rejects(
    () =>
      service.updateMemberRole(
        "event_1",
        "member_owner",
        { role: "reviewer" },
        "user_owner",
      ),
    BadRequestException,
  );
  assert.equal(prisma.eventMembership.update.calls.length, 0);
});

test("demoting the legacy owner id keeps ownerId pointed at an owner", async () => {
  let eventReadCount = 0;
  const prisma = {
    event: {
      findUnique: mockFn(async () => {
        eventReadCount += 1;

        if (eventReadCount === 1) {
          return permissionEvent({
            members: [
              {
                id: "member_owner",
                eventId: "event_1",
                userId: "user_owner",
                role: EventMemberRole.OWNER,
              },
              {
                id: "member_second_owner",
                eventId: "event_1",
                userId: "user_second_owner",
                role: EventMemberRole.OWNER,
              },
            ],
          });
        }

        return eventResponse({
          ownerId: "user_second_owner",
          members: [
            {
              id: "member_owner",
              eventId: "event_1",
              userId: "user_owner",
              role: EventMemberRole.REVIEWER,
              createdAt: now,
              updatedAt: now,
              user: {
                id: "user_owner",
                email: "owner@example.com",
                name: "Owner",
              },
            },
            {
              id: "member_second_owner",
              eventId: "event_1",
              userId: "user_second_owner",
              role: EventMemberRole.OWNER,
              createdAt: now,
              updatedAt: now,
              user: {
                id: "user_second_owner",
                email: "second-owner@example.com",
                name: "Second Owner",
              },
            },
          ],
        });
      }),
      update: mockFn(async () => null),
    },
    eventMembership: {
      update: mockFn(async () => null),
    },
  };
  const service = new EventsService(prisma);

  const response = await service.updateMemberRole(
    "event_1",
    "member_owner",
    { role: "reviewer" },
    "user_owner",
  );

  assert.deepEqual(prisma.event.update.calls[0][0], {
    where: { id: "event_1" },
    data: { ownerId: "user_second_owner" },
  });
  assert.deepEqual(
    response.members.map((member) => member.role),
    ["reviewer", "owner"],
  );
});

test("reviewers cannot change event member roles", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () =>
        permissionEvent({
          members: [
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.REVIEWER,
            },
          ],
        }),
      ),
    },
    eventMembership: {
      update: mockFn(),
    },
  };
  const service = new EventsService(prisma);

  await assert.rejects(
    () =>
      service.updateMemberRole(
        "event_1",
        "member_reviewer",
        { role: "owner" },
        "user_reviewer",
      ),
    ForbiddenException,
  );
  assert.equal(prisma.eventMembership.update.calls.length, 0);
});

test("owners cannot be removed through the reviewer management endpoint", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () => permissionEvent()),
    },
    eventMembership: {
      delete: mockFn(),
    },
  };
  const service = new EventsService(prisma);

  await assert.rejects(
    () => service.removeMember("event_1", "member_owner", "user_owner"),
    BadRequestException,
  );
  assert.equal(prisma.eventMembership.delete.calls.length, 0);
});

test("reviewers cannot add template fields", async () => {
  const prisma = {
    attendanceTemplate: {
      findUnique: mockFn(async () => ({
        id: "template_1",
        eventId: "event_1",
        name: "Default attendance template",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
        event: permissionEvent({
          members: [
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.REVIEWER,
            },
          ],
        }),
        fields: [],
      })),
    },
    templateField: {
      create: mockFn(),
    },
  };
  const service = new EventsService(prisma);

  await assert.rejects(
    () =>
      service.createTemplateField(
        "template_1",
        {
          label: "Taxa",
          key: "taxa",
          type: "text",
          required: false,
        },
        "user_reviewer",
      ),
    ForbiddenException,
  );
  assert.equal(prisma.templateField.create.calls.length, 0);
});

test("owners can update an event and its default template fields", async () => {
  const existingEvent = eventResponse({
    templates: [
      {
        id: "template_1",
        eventId: "event_1",
        name: "Default attendance template",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
        fields: [templateField(), emailTemplateField()],
      },
    ],
  });
  const updatedEvent = eventResponse({
    title: "Updated Seminar",
    description: "Updated description",
    eventDate: null,
    templates: [
      {
        id: "template_1",
        eventId: "event_1",
        name: "Updated template",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
        fields: [
          {
            ...templateField(),
            label: "Full Name",
            key: "full_name",
            aliases: ["Name"],
          },
          {
            id: "field_phone",
            templateId: "template_1",
            label: "Phone",
            key: "phone",
            type: "PHONE",
            required: false,
            sortOrder: 2,
            aliases: [],
            options: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
  });
  const prisma = {
    event: {
      findUnique: mockFn(async () => existingEvent),
      update: mockFn(async () => null),
      findUniqueOrThrow: mockFn(async () => updatedEvent),
    },
    attendanceTemplate: {
      update: mockFn(async () => null),
      create: mockFn(),
    },
    templateField: {
      deleteMany: mockFn(async () => ({ count: 1 })),
      update: mockFn(async () => null),
      create: mockFn(async () => null),
    },
    attendanceRecord: {
      findMany: mockFn(async () => [
        {
          id: "record_1",
          dataJson: {
            name: "Ada",
            email: "ada@example.com",
            notes: "Keep",
          },
        },
      ]),
      update: mockFn(async () => null),
    },
    $transaction: mockFn(async (callback) => callback(prisma)),
  };
  const service = new EventsService(prisma);

  const response = await service.updateEvent(
    "event_1",
    {
      title: "Updated Seminar",
      description: "Updated description",
      eventDate: null,
      templateName: "Updated template",
      fields: [
        {
          id: "field_name",
          label: "Full Name",
          key: "full_name",
          type: "text",
          required: true,
          aliases: ["Name"],
          options: [],
        },
        {
          label: "Phone",
          key: "phone",
          type: "phone",
          required: false,
          aliases: [],
          options: [],
        },
      ],
    },
    "user_owner",
  );

  assert.deepEqual(prisma.event.update.calls[0][0], {
    where: { id: "event_1" },
    data: {
      title: "Updated Seminar",
      description: "Updated description",
      eventDate: null,
    },
  });
  assert.deepEqual(prisma.attendanceTemplate.update.calls[0][0], {
    where: { id: "template_1" },
    data: { name: "Updated template" },
  });
  assert.deepEqual(prisma.templateField.deleteMany.calls[0][0], {
    where: {
      templateId: "template_1",
      id: { notIn: ["field_name"] },
    },
  });
  assert.match(
    prisma.templateField.update.calls[0][0].data.key,
    /^__crowdlog_edit_0_field_name$/,
  );
  assert.deepEqual(prisma.templateField.update.calls[1][0], {
    where: { id: "field_name" },
    data: {
      label: "Full Name",
      key: "full_name",
      type: "TEXT",
      required: true,
      sortOrder: 1,
      aliases: ["Name"],
      options: [],
    },
  });
  assert.equal(prisma.templateField.create.calls[0][0].data.key, "phone");
  assert.deepEqual(prisma.attendanceRecord.update.calls[0][0], {
    where: { id: "record_1" },
    data: {
      dataJson: {
        notes: "Keep",
        full_name: "Ada",
      },
    },
  });
  assert.equal(response.title, "Updated Seminar");
  assert.equal(response.template.name, "Updated template");
  assert.deepEqual(
    response.template.fields.map((field) => field.key),
    ["full_name", "phone"],
  );
});

test("reviewers cannot update event templates", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () =>
        eventResponse({
          members: [
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.REVIEWER,
              createdAt: now,
              updatedAt: now,
              user: {
                id: "user_reviewer",
                email: "reviewer@example.com",
                name: "Reviewer",
              },
            },
          ],
        }),
      ),
    },
    $transaction: mockFn(),
  };
  const service = new EventsService(prisma);

  await assert.rejects(
    () =>
      service.updateEvent(
        "event_1",
        {
          title: "Updated Seminar",
        },
        "user_reviewer",
      ),
    ForbiddenException,
  );
  assert.equal(prisma.$transaction.calls.length, 0);
});

test("duplicate field keys are rejected when updating event templates", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () => eventResponse()),
    },
    $transaction: mockFn(),
  };
  const service = new EventsService(prisma);

  await assert.rejects(
    () =>
      service.updateEvent(
        "event_1",
        {
          fields: [
            {
              label: "Name",
              key: "name",
              type: "text",
              required: true,
            },
            {
              label: "Preferred name",
              key: "name",
              type: "text",
              required: false,
            },
          ],
        },
        "user_owner",
      ),
    BadRequestException,
  );
  assert.equal(prisma.$transaction.calls.length, 0);
});

test("reviewers can list records for events where they are members", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () =>
        eventResponse({
          members: [
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.REVIEWER,
              createdAt: now,
              updatedAt: now,
              user: {
                id: "user_reviewer",
                email: "reviewer@example.com",
                name: "Reviewer",
              },
            },
          ],
          templates: [
            {
              id: "template_1",
              name: "Default attendance template",
              fields: [templateField()],
            },
          ],
        }),
      ),
    },
    attendanceRecord: {
      findMany: mockFn(async () => []),
    },
  };
  const service = new RecordsService({ extract: mockFn() }, prisma);

  const records = await service.listRecords("event_1", "user_reviewer");

  assert.deepEqual(records, []);
  assert.equal(prisma.attendanceRecord.findMany.calls.length, 1);
});

test("outsiders cannot list event records", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () =>
        eventResponse({
          members: [],
          templates: [
            {
              id: "template_1",
              name: "Default attendance template",
              fields: [templateField()],
            },
          ],
        }),
      ),
    },
    attendanceRecord: {
      findMany: mockFn(),
    },
  };
  const service = new RecordsService({ extract: mockFn() }, prisma);

  await assert.rejects(
    () => service.listRecords("event_1", "user_outsider"),
    NotFoundException,
  );
  assert.equal(prisma.attendanceRecord.findMany.calls.length, 0);
});

test("reviewers can export full event records as CSV", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () =>
        eventResponse({
          title: "Seminar Attendance",
          members: [
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.REVIEWER,
              createdAt: now,
              updatedAt: now,
              user: {
                id: "user_reviewer",
                email: "reviewer@example.com",
                name: "Reviewer",
              },
            },
          ],
          templates: [
            {
              id: "template_1",
              name: "Default attendance template",
              fields: [templateField(), emailTemplateField()],
            },
          ],
        }),
      ),
    },
    attendanceRecord: {
      findMany: mockFn(async () => [
        {
          id: "record_1",
          eventId: "event_1",
          documentId: "document_1",
          rowNumber: 2,
          dataJson: {
            name: 'Ada "Ace"',
            email: "ada@example.com",
          },
          confidenceScore: 0.83,
          status: AttendanceRecordStatus.NEEDS_REVIEW,
          document: {
            id: "document_1",
            fileName: "week 1.csv",
          },
          createdAt: now,
          updatedAt: now,
        },
      ]),
    },
  };
  const service = new RecordsService({ extract: mockFn() }, prisma);

  const exportFile = await service.exportRecordsCsv("event_1", "user_reviewer");

  assert.equal(exportFile.fileName, "seminar-attendance-attendance.csv");
  assert.equal(
    exportFile.content,
    [
      "Event,Row,Status,Confidence,Document,Name,Email",
      'Seminar Attendance,2,Needs review,83%,week 1.csv,"Ada ""Ace""",ada@example.com',
    ].join("\r\n"),
  );
  assert.equal(prisma.attendanceRecord.findMany.calls.length, 1);
});

test("reviewers can export full event records as an Excel workbook", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () =>
        eventResponse({
          title: "Seminar Attendance",
          members: [
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.REVIEWER,
              createdAt: now,
              updatedAt: now,
              user: {
                id: "user_reviewer",
                email: "reviewer@example.com",
                name: "Reviewer",
              },
            },
          ],
          templates: [
            {
              id: "template_1",
              name: "Default attendance template",
              fields: [templateField(), emailTemplateField()],
            },
          ],
        }),
      ),
    },
    attendanceRecord: {
      findMany: mockFn(async () => [
        {
          id: "record_1",
          eventId: "event_1",
          documentId: "document_1",
          rowNumber: 2,
          dataJson: {
            name: "Ada & Co",
            email: "ada@example.com",
          },
          confidenceScore: 0.83,
          status: AttendanceRecordStatus.NEEDS_REVIEW,
          document: {
            id: "document_1",
            fileName: "week 1.csv",
          },
          createdAt: now,
          updatedAt: now,
        },
      ]),
    },
  };
  const service = new RecordsService({ extract: mockFn() }, prisma);

  const exportFile = await service.exportRecordsXlsx("event_1", "user_reviewer");
  const entries = readStoredZipEntries(exportFile.content);
  const worksheet = entries.get("xl/worksheets/sheet1.xml");

  assert.equal(exportFile.fileName, "seminar-attendance-attendance.xlsx");
  assert.equal(exportFile.content.subarray(0, 2).toString("utf8"), "PK");
  assert.ok(entries.has("[Content_Types].xml"));
  assert.ok(entries.has("xl/workbook.xml"));
  assert.ok(worksheet.includes('<dimension ref="A1:G2"/>'));
  assert.ok(worksheet.includes("Ada &amp; Co"));
  assert.ok(worksheet.includes("Needs review"));
  assert.equal(prisma.attendanceRecord.findMany.calls.length, 1);
});

test("outsiders cannot export event records", async () => {
  const prisma = {
    event: {
      findUnique: mockFn(async () =>
        eventResponse({
          members: [],
          templates: [
            {
              id: "template_1",
              name: "Default attendance template",
              fields: [templateField()],
            },
          ],
        }),
      ),
    },
    attendanceRecord: {
      findMany: mockFn(),
    },
  };
  const service = new RecordsService({ extract: mockFn() }, prisma);

  await assert.rejects(
    () => service.exportRecordsCsv("event_1", "user_outsider"),
    NotFoundException,
  );
  assert.equal(prisma.attendanceRecord.findMany.calls.length, 0);
});

test("reviewers can approve rows for events where they are members", async () => {
  const prisma = {
    attendanceRecord: {
      findUnique: mockFn(async () => ({
        id: "record_1",
        eventId: "event_1",
        event: permissionEvent({
          members: [
            {
              id: "member_reviewer",
              eventId: "event_1",
              userId: "user_reviewer",
              role: EventMemberRole.REVIEWER,
            },
          ],
        }),
      })),
      update: mockFn(async (input) => {
        assert.equal(input.data.status, AttendanceRecordStatus.APPROVED);
        assert.deepEqual(input.data.reviewedBy, {
          connect: { id: "user_reviewer" },
        });
        assert.ok(input.data.reviewedAt instanceof Date);
        return recordResponse(AttendanceRecordStatus.APPROVED);
      }),
    },
  };
  const service = new RecordsService({ extract: mockFn() }, prisma);

  const record = await service.approveRecord("record_1", "user_reviewer");

  assert.equal(record.status, "approved");
});
