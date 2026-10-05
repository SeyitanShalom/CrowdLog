import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { EventMemberRole, Prisma } from "@prisma/client";
import { InvitationEmailService } from "../invitations/invitation-email.service";
import { PrismaService } from "../prisma/prisma.service";
import { UploadStorageService } from "../storage/upload-storage.service";
import { AddEventReviewerDto } from "./dto/add-event-reviewer.dto";
import { CreateEventDto } from "./dto/create-event.dto";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { TemplateFieldInputDto } from "./dto/template-field-input.dto";
import {
  UpdateEventDto,
  UpdateTemplateFieldInputDto,
} from "./dto/update-event.dto";
import { UpdateEventMemberDto } from "./dto/update-event-member.dto";
import {
  getEventInclude,
  toEventResponse,
  toFieldResponse,
  toTemplateResponse,
} from "./event-response.mapper";
import { toPrismaFieldType } from "./field-type.mapper";

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly invitationEmailService?: InvitationEmailService,
    private readonly uploadStorage: UploadStorageService = new UploadStorageService(),
  ) {}

  async listEvents(userId: string) {
    const events = await this.prisma.event.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: { userId },
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: getEventInclude(),
    });

    return events.map(toEventResponse);
  }

  async getEvent(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: getEventInclude(),
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanAccessEvent(event, userId);

    return toEventResponse(event);
  }

  async createEvent(dto: CreateEventDto, userId: string) {
    const fields = dto.fields ?? [];

    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        eventDate: dto.eventDate ? new Date(dto.eventDate) : undefined,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: EventMemberRole.OWNER,
          },
        },
        templates: {
          create: {
            name: dto.templateName ?? "Default attendance template",
            isDefault: true,
            fields: {
              create: fields.map((field, index) =>
                this.toTemplateFieldCreateInput(field, index),
              ),
            },
          },
        },
      },
      include: getEventInclude(),
    });

    return toEventResponse(event);
  }

  async deleteEvent(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        members: true,
        documents: {
          select: { fileUrl: true },
        },
      },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanManageEvent(event, userId);

    await this.prisma.event.delete({
      where: { id: eventId },
    });

    await Promise.all(
      event.documents.map((document) => this.deleteUploadedFile(document.fileUrl)),
    );

    return { id: eventId };
  }

  async updateEvent(eventId: string, dto: UpdateEventDto, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        members: true,
        templates: {
          orderBy: { createdAt: "asc" },
          include: {
            fields: {
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanManageEvent(event, userId);

    if (dto.fields) {
      this.ensureUniqueFieldKeys(dto.fields);
    }

    const updatedEvent = await this.prisma.$transaction(async (tx) => {
      const eventData: Prisma.EventUpdateInput = {};

      if (dto.title !== undefined) {
        eventData.title = dto.title;
      }

      if ("description" in dto) {
        eventData.description = dto.description ?? null;
      }

      if ("eventDate" in dto) {
        eventData.eventDate = dto.eventDate ? new Date(dto.eventDate) : null;
      }

      if (Object.keys(eventData).length > 0) {
        await tx.event.update({
          where: { id: eventId },
          data: eventData,
        });
      }

      const template =
        event.templates.find((candidate) => candidate.isDefault) ??
        event.templates[0];

      if (template) {
        if (dto.templateName !== undefined) {
          await tx.attendanceTemplate.update({
            where: { id: template.id },
            data: { name: dto.templateName },
          });
        }

        if (dto.fields) {
          await this.replaceTemplateFields(tx, template, dto.fields);
        }
      } else if (dto.templateName !== undefined || dto.fields) {
        await tx.attendanceTemplate.create({
          data: {
            eventId,
            name: dto.templateName ?? "Default attendance template",
            isDefault: true,
            fields: {
              create: (dto.fields ?? []).map((field, index) =>
                this.toTemplateFieldCreateInput(field, index),
              ),
            },
          },
        });
      }

      return tx.event.findUniqueOrThrow({
        where: { id: eventId },
        include: getEventInclude(),
      });
    });

    return toEventResponse(updatedEvent);
  }

  async addReviewer(
    eventId: string,
    dto: AddEventReviewerDto,
    userId: string,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { members: true },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanManageEvent(event, userId);

    const email = dto.email.trim().toLowerCase();
    const name = dto.name?.trim() || null;

    const reviewer = await this.prisma.user.upsert({
      where: { email },
      update: {
        name: name ?? undefined,
      },
      create: {
        email,
        name,
      },
    });

    const existingMembership = await this.prisma.eventMembership.findUnique({
      where: {
        eventId_userId: {
          eventId,
          userId: reviewer.id,
        },
      },
    });

    if (!existingMembership) {
      await this.prisma.eventMembership.create({
        data: {
          eventId,
          userId: reviewer.id,
          role: EventMemberRole.REVIEWER,
        },
      });

      await this.sendReviewerInvitation({
        eventId,
        eventTitle: event.title,
        reviewerEmail: reviewer.email,
        reviewerName: reviewer.name,
        invitedByUserId: userId,
      });
    }

    return this.getEvent(eventId, userId);
  }

  async removeMember(eventId: string, memberId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { members: true },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanManageEvent(event, userId);

    const membership = event.members.find((member) => member.id === memberId);

    if (!membership) {
      throw new NotFoundException("Event member not found.");
    }

    if (membership.role === EventMemberRole.OWNER) {
      throw new BadRequestException("Owners cannot be removed here.");
    }

    await this.prisma.eventMembership.delete({
      where: { id: memberId },
    });

    return this.getEvent(eventId, userId);
  }

  async updateMemberRole(
    eventId: string,
    memberId: string,
    dto: UpdateEventMemberDto,
    userId: string,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { members: true },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanManageEvent(event, userId);

    const membership = event.members.find((member) => member.id === memberId);

    if (!membership) {
      throw new NotFoundException("Event member not found.");
    }

    const nextRole = toPrismaEventMemberRole(dto.role);

    if (membership.role === nextRole) {
      return this.getEvent(eventId, userId);
    }

    const remainingOwners = event.members.filter(
      (member) =>
        member.id !== memberId && member.role === EventMemberRole.OWNER,
    );

    if (
      membership.role === EventMemberRole.OWNER &&
      nextRole === EventMemberRole.REVIEWER &&
      remainingOwners.length === 0
    ) {
      throw new BadRequestException("An event must have at least one owner.");
    }

    await this.prisma.eventMembership.update({
      where: { id: memberId },
      data: { role: nextRole },
    });

    if (
      membership.role === EventMemberRole.OWNER &&
      nextRole === EventMemberRole.REVIEWER &&
      event.ownerId === membership.userId
    ) {
      await this.prisma.event.update({
        where: { id: eventId },
        data: { ownerId: remainingOwners[0].userId },
      });
    } else if (nextRole === EventMemberRole.OWNER && !event.ownerId) {
      await this.prisma.event.update({
        where: { id: eventId },
        data: { ownerId: membership.userId },
      });
    }

    return this.getEvent(eventId, userId);
  }

  async createTemplate(eventId: string, dto: CreateTemplateDto, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { members: true },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    this.ensureCanManageEvent(event, userId);

    const fields = dto.fields ?? [];

    const template = await this.prisma.attendanceTemplate.create({
      data: {
        eventId,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        fields: {
          create: fields.map((field, index) =>
            this.toTemplateFieldCreateInput(field, index),
          ),
        },
      },
      include: {
        fields: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return toTemplateResponse(template);
  }

  async createTemplateField(
    templateId: string,
    dto: TemplateFieldInputDto,
    userId: string,
  ) {
    const template = await this.prisma.attendanceTemplate.findUnique({
      where: { id: templateId },
      include: {
        event: {
          include: { members: true },
        },
        fields: true,
      },
    });

    if (!template) {
      throw new NotFoundException("Attendance template not found.");
    }

    this.ensureCanManageEvent(template.event, userId);

    const field = await this.prisma.templateField.create({
      data: {
        ...this.toTemplateFieldCreateInput(dto, template.fields.length),
        templateId,
      },
    });

    return toFieldResponse(field);
  }

  private ensureCanAccessEvent(
    event: { ownerId: string | null; members: Array<{ userId: string }> },
    userId: string,
  ) {
    if (
      event.ownerId === userId ||
      event.members.some((member) => member.userId === userId)
    ) {
      return;
    }

    throw new NotFoundException("Event not found.");
  }

  private ensureCanManageEvent(
    event: {
      ownerId: string | null;
      members: Array<{ userId: string; role: EventMemberRole }>;
    },
    userId: string,
  ) {
    const membership = event.members.find((member) => member.userId === userId);

    if (membership?.role === EventMemberRole.OWNER) {
      return;
    }

    if (!membership && event.ownerId === userId) {
      return;
    }

    throw new ForbiddenException("Only event owners can change this event.");
  }

  private toTemplateFieldCreateInput(
    field: TemplateFieldInputDto,
    index: number,
  ): Prisma.TemplateFieldCreateWithoutTemplateInput {
    return {
      label: field.label,
      key: field.key,
      type: toPrismaFieldType(field.type),
      required: field.required ?? false,
      sortOrder: field.sortOrder ?? index + 1,
      aliases: field.aliases ?? [],
      options: fieldUsesOptions(field.type) ? field.options ?? [] : [],
    };
  }

  private toTemplateFieldUpdateInput(
    field: TemplateFieldInputDto,
    index: number,
  ): Prisma.TemplateFieldUpdateInput {
    return {
      label: field.label,
      key: field.key,
      type: toPrismaFieldType(field.type),
      required: field.required ?? false,
      sortOrder: field.sortOrder ?? index + 1,
      aliases: field.aliases ?? [],
      options: fieldUsesOptions(field.type) ? field.options ?? [] : [],
    };
  }

  private async replaceTemplateFields(
    tx: Prisma.TransactionClient,
    template: {
      id: string;
      eventId: string;
      fields: Array<{ id: string; key: string }>;
    },
    fields: UpdateTemplateFieldInputDto[],
  ) {
    const existingFieldsById = new Map(
      template.fields.map((field) => [field.id, field]),
    );
    const retainedFieldIds = fields
      .map((field) => field.id)
      .filter((id): id is string => Boolean(id && existingFieldsById.has(id)));
    const retainedFieldIdSet = new Set(retainedFieldIds);
    const removedFieldKeys = template.fields
      .filter((field) => !retainedFieldIdSet.has(field.id))
      .map((field) => field.key);
    const keyChanges = fields
      .filter((field) => field.id && existingFieldsById.has(field.id))
      .map((field) => {
        const existingField = existingFieldsById.get(field.id ?? "");

        return existingField && existingField.key !== field.key
          ? { oldKey: existingField.key, newKey: field.key }
          : null;
      })
      .filter(
        (change): change is { oldKey: string; newKey: string } =>
          change !== null,
      );

    await tx.templateField.deleteMany({
      where: {
        templateId: template.id,
        ...(retainedFieldIds.length > 0
          ? { id: { notIn: retainedFieldIds } }
          : {}),
      },
    });

    await Promise.all(
      fields.map((field, index) => {
        const fieldId = field.id;

        if (!fieldId || !existingFieldsById.has(fieldId)) {
          return Promise.resolve();
        }

        const existingField = existingFieldsById.get(fieldId);

        if (existingField?.key === field.key) {
          return Promise.resolve();
        }

        return tx.templateField.update({
          where: { id: fieldId },
          data: { key: `__crowdlog_edit_${index}_${fieldId}` },
        });
      }),
    );

    await Promise.all(
      fields.map((field, index) => {
        const fieldId = field.id;

        if (fieldId && existingFieldsById.has(fieldId)) {
          return tx.templateField.update({
            where: { id: fieldId },
            data: this.toTemplateFieldUpdateInput(field, index),
          });
        }

        return tx.templateField.create({
          data: {
            ...this.toTemplateFieldCreateInput(field, index),
            templateId: template.id,
          },
        });
      }),
    );

    await this.migrateRecordDataKeys(
      tx,
      template.eventId,
      keyChanges,
      removedFieldKeys,
    );
  }

  private ensureUniqueFieldKeys(fields: TemplateFieldInputDto[]) {
    const seenKeys = new Set<string>();

    for (const field of fields) {
      if (seenKeys.has(field.key)) {
        throw new BadRequestException(`Duplicate field key: ${field.key}.`);
      }

      seenKeys.add(field.key);
    }
  }

  private async migrateRecordDataKeys(
    tx: Prisma.TransactionClient,
    eventId: string,
    keyChanges: Array<{ oldKey: string; newKey: string }>,
    removedFieldKeys: string[],
  ) {
    if (keyChanges.length === 0 && removedFieldKeys.length === 0) {
      return;
    }

    const records = await tx.attendanceRecord.findMany({
      where: { eventId },
      select: {
        id: true,
        dataJson: true,
      },
    });

    await Promise.all(
      records.map((record) => {
        const currentData = this.jsonRecord(record.dataJson);
        const nextData: Record<string, string | number | boolean | null> = {
          ...currentData,
        };
        let didChange = false;

        for (const key of removedFieldKeys) {
          if (Object.prototype.hasOwnProperty.call(nextData, key)) {
            delete nextData[key];
            didChange = true;
          }
        }

        for (const change of keyChanges) {
          if (Object.prototype.hasOwnProperty.call(nextData, change.oldKey)) {
            delete nextData[change.oldKey];
            didChange = true;
          }
        }

        for (const change of keyChanges) {
          if (
            Object.prototype.hasOwnProperty.call(currentData, change.oldKey)
          ) {
            nextData[change.newKey] = currentData[change.oldKey];
            didChange = true;
          }
        }

        if (!didChange) {
          return Promise.resolve();
        }

        return tx.attendanceRecord.update({
          where: { id: record.id },
          data: {
            dataJson: nextData as Prisma.InputJsonObject,
          },
        });
      }),
    );
  }

  private jsonRecord(value: Prisma.JsonValue) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, string | number | boolean | null> = {};

    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null
      ) {
        result[key] = item;
      }
    }

    return result;
  }

  private async deleteUploadedFile(fileUrl: string) {
    if (!fileUrl.startsWith("/uploads/")) {
      return;
    }

    await this.uploadStorage.deleteFile(fileUrl).catch(() => {
      // The database delete is the source of truth; missing stored files are harmless.
    });
  }

  private async sendReviewerInvitation({
    eventId,
    eventTitle,
    reviewerEmail,
    reviewerName,
    invitedByUserId,
  }: {
    eventId: string;
    eventTitle: string;
    reviewerEmail: string;
    reviewerName: string | null;
    invitedByUserId: string;
  }) {
    if (!this.invitationEmailService) {
      return;
    }

    try {
      const inviter = await this.prisma.user.findUnique({
        where: { id: invitedByUserId },
        select: {
          email: true,
          name: true,
        },
      });

      await this.invitationEmailService.sendReviewerInvitation({
        eventId,
        eventTitle,
        reviewerEmail,
        reviewerName,
        invitedByEmail: inviter?.email ?? null,
        invitedByName: inviter?.name ?? null,
      });
    } catch (error) {
      console.warn("Could not queue reviewer invitation.", error);
    }
  }
}

function toPrismaEventMemberRole(role: UpdateEventMemberDto["role"]) {
  return role === "owner" ? EventMemberRole.OWNER : EventMemberRole.REVIEWER;
}

function fieldUsesOptions(type: TemplateFieldInputDto["type"]) {
  return type === "select" || type === "multi_select";
}
