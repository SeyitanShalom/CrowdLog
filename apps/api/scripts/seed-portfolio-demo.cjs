const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  AttendanceDocumentStatus,
  AttendanceRecordStatus,
  EventMemberRole,
  PrismaClient,
  TemplateFieldType,
} = require("@prisma/client");

loadLocalEnv();

const prisma = new PrismaClient();

const DEMO_EVENT_TITLE = "Portfolio Demo: Computer Science Seminar";

const users = {
  owner: {
    email: "owner.demo@crowdlog.local",
    name: "Amina Okafor",
  },
  reviewerOne: {
    email: "reviewer.one@crowdlog.local",
    name: "Tunde Bello",
  },
  reviewerTwo: {
    email: "reviewer.two@crowdlog.local",
    name: "Maya Chen",
  },
};

const fields = [
  {
    label: "Name",
    key: "name",
    type: TemplateFieldType.TEXT,
    required: true,
    sortOrder: 1,
    aliases: ["Full Name", "Student Name"],
    options: [],
  },
  {
    label: "Matric Number",
    key: "matric_number",
    type: TemplateFieldType.TEXT,
    required: true,
    sortOrder: 2,
    aliases: ["Matric No", "Reg No", "Student ID"],
    options: [],
  },
  {
    label: "Department",
    key: "department",
    type: TemplateFieldType.TEXT,
    required: true,
    sortOrder: 3,
    aliases: ["Dept", "Programme"],
    options: [],
  },
  {
    label: "Level",
    key: "level",
    type: TemplateFieldType.SELECT,
    required: false,
    sortOrder: 4,
    aliases: ["Year"],
    options: ["100", "200", "300", "400", "500"],
  },
  {
    label: "Email",
    key: "email",
    type: TemplateFieldType.EMAIL,
    required: false,
    sortOrder: 5,
    aliases: ["Email Address"],
    options: [],
  },
  {
    label: "Signature",
    key: "signature",
    type: TemplateFieldType.SIGNATURE,
    required: false,
    sortOrder: 6,
    aliases: ["Sign"],
    options: [],
  },
];

const documentSeeds = [
  {
    fileName: "cs-seminar-sheet-01.png",
    fileType: "image/png",
    fileUrl: "mock://portfolio/cs-seminar-sheet-01.png",
    rows: [
      {
        rowNumber: 1,
        status: AttendanceRecordStatus.APPROVED,
        confidenceScore: 0.96,
        reviewedBy: "reviewerOne",
        reviewedAt: "2026-09-30T09:12:00.000Z",
        data: {
          name: "Ada Morgan",
          matric_number: "CSC/22/1041",
          department: "Computer Science",
          level: "300",
          email: "ada.morgan@example.test",
          signature: "signed",
        },
      },
      {
        rowNumber: 2,
        status: AttendanceRecordStatus.APPROVED,
        confidenceScore: 0.91,
        reviewedBy: "reviewerOne",
        reviewedAt: "2026-09-30T09:16:00.000Z",
        data: {
          name: "Noah Patel",
          matric_number: "CSC/21/0887",
          department: "Computer Science",
          level: "400",
          email: "noah.patel@example.test",
          signature: "signed",
        },
      },
      {
        rowNumber: 3,
        status: AttendanceRecordStatus.NEEDS_REVIEW,
        confidenceScore: 0.62,
        data: {
          name: "Mira Johnson",
          matric_number: "CSC/23/11O9",
          department: "Computer Science",
          level: "200",
          email: "mira.johnson at example.test",
          signature: "",
        },
        issues: {
          matric_number: ["Possible OCR confusion in matric number."],
          email: ["Email address is invalid."],
          signature: ["Signature is required for this sheet."],
        },
      },
      {
        rowNumber: 4,
        status: AttendanceRecordStatus.REJECTED,
        confidenceScore: 0.57,
        reviewedBy: "reviewerTwo",
        reviewedAt: "2026-09-30T09:28:00.000Z",
        data: {
          name: "Duplicate row",
          matric_number: "CSC/22/1041",
          department: "Computer Science",
          level: "300",
          email: "ada.morgan@example.test",
          signature: "signed",
        },
      },
    ],
  },
  {
    fileName: "cs-seminar-sheet-02.png",
    fileType: "image/png",
    fileUrl: "mock://portfolio/cs-seminar-sheet-02.png",
    rows: [
      {
        rowNumber: 5,
        status: AttendanceRecordStatus.APPROVED,
        confidenceScore: 0.88,
        reviewedBy: "reviewerTwo",
        reviewedAt: "2026-09-30T09:42:00.000Z",
        data: {
          name: "Ife Santos",
          matric_number: "CSC/22/1174",
          department: "Software Engineering",
          level: "300",
          email: "ife.santos@example.test",
          signature: "signed",
        },
      },
      {
        rowNumber: 6,
        status: AttendanceRecordStatus.DRAFT,
        confidenceScore: 0.81,
        data: {
          name: "Lina Adeyemi",
          matric_number: "CSC/24/1302",
          department: "Computer Science",
          level: "100",
          email: "lina.adeyemi@example.test",
          signature: "",
        },
      },
      {
        rowNumber: 7,
        status: AttendanceRecordStatus.NEEDS_REVIEW,
        confidenceScore: 0.68,
        data: {
          name: "Sam Rivera",
          matric_number: "CSC/21/07B4",
          department: "Information Systems",
          level: "400",
          email: "sam.rivera@example.test",
          signature: "signed",
        },
        issues: {
          matric_number: ["Possible OCR confusion in matric number."],
        },
      },
      {
        rowNumber: 8,
        status: AttendanceRecordStatus.APPROVED,
        confidenceScore: 0.94,
        reviewedBy: "reviewerOne",
        reviewedAt: "2026-09-30T09:55:00.000Z",
        data: {
          name: "Rae Thomas",
          matric_number: "CSC/20/0644",
          department: "Computer Science",
          level: "500",
          email: "rae.thomas@example.test",
          signature: "signed",
        },
      },
    ],
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Set it in apps/api/.env or the shell before seeding.",
    );
  }

  const owner = await upsertUser(users.owner);
  const reviewerOne = await upsertUser(users.reviewerOne);
  const reviewerTwo = await upsertUser(users.reviewerTwo);
  const existingEvent = await prisma.event.findFirst({
    where: {
      title: DEMO_EVENT_TITLE,
      ownerId: owner.id,
    },
    select: { id: true },
  });

  if (existingEvent) {
    await prisma.event.delete({
      where: { id: existingEvent.id },
    });
  }

  const event = await prisma.event.create({
    data: {
      title: DEMO_EVENT_TITLE,
      description:
        "An anonymized demo event for portfolio screenshots and export testing.",
      eventDate: new Date("2026-09-30T09:00:00.000Z"),
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: EventMemberRole.OWNER },
          { userId: reviewerOne.id, role: EventMemberRole.REVIEWER },
          { userId: reviewerTwo.id, role: EventMemberRole.REVIEWER },
        ],
      },
      templates: {
        create: {
          name: "Portfolio attendance template",
          isDefault: true,
          fields: {
            create: fields,
          },
        },
      },
    },
    include: {
      templates: {
        include: {
          fields: true,
        },
      },
    },
  });

  const templateFields = [...event.templates[0].fields].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const reviewerByKey = {
    reviewerOne,
    reviewerTwo,
  };

  for (const documentSeed of documentSeeds) {
    const document = await prisma.attendanceDocument.create({
      data: {
        eventId: event.id,
        fileName: documentSeed.fileName,
        fileType: documentSeed.fileType,
        fileUrl: documentSeed.fileUrl,
        status: AttendanceDocumentStatus.EXTRACTED,
        rawOcrJson: {
          source: "portfolio-seed",
          rows: documentSeed.rows.length,
        },
      },
    });

    for (const row of documentSeed.rows) {
      const reviewer = row.reviewedBy ? reviewerByKey[row.reviewedBy] : null;

      await prisma.attendanceRecord.create({
        data: {
          eventId: event.id,
          documentId: document.id,
          reviewedByUserId: reviewer?.id,
          reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
          rowNumber: row.rowNumber,
          dataJson: row.data,
          confidenceScore: row.confidenceScore,
          status: row.status,
          values: {
            create: templateFields.map((field) => ({
              fieldId: field.id,
              rawValue: stringifyValue(row.data[field.key]),
              normalizedValue: stringifyValue(row.data[field.key]),
              confidence: confidenceFor(row, field.key),
              validationIssues: row.issues?.[field.key] ?? [],
            })),
          },
        },
      });
    }
  }

  console.log("Seeded CrowdLog portfolio demo.");
  console.log(`Owner: ${owner.email}`);
  console.log(`Reviewers: ${reviewerOne.email}, ${reviewerTwo.email}`);
  console.log(`Event: ${DEMO_EVENT_TITLE}`);
}

function upsertUser(user) {
  return prisma.user.upsert({
    where: { email: user.email },
    update: { name: user.name },
    create: user,
  });
}

function confidenceFor(row, fieldKey) {
  if (row.issues?.[fieldKey]?.length) {
    return Math.min(row.confidenceScore, 0.58);
  }

  return row.confidenceScore;
}

function stringifyValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function loadLocalEnv() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const envPath = resolve(__dirname, "..", ".env");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

main()
  .catch((error) => {
    console.error("Could not seed the CrowdLog portfolio demo.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
