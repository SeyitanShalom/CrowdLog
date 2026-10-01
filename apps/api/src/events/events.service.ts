import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { EventMemberRole, Prisma } from "@prisma/client";
import { unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { InvitationEmailService } from "../invitations/invitation-email.service";
import { PrismaService } from "../prisma/prisma.service";
import { AddEventReviewerDto } from "./dto/add-event-reviewer.dto";
import { CreateEventDto } from "./dto/create-event.dto";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { TemplateFieldInputDto } from "./dto/template-field-input.dto";
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
      options: field.type === "select" ? field.options ?? [] : [],
    };
  }

  private async deleteUploadedFile(fileUrl: string) {
    if (!fileUrl.startsWith("/uploads/")) {
      return;
    }

    const fileName = fileUrl.replace("/uploads/", "");

    if (fileName !== basename(fileName)) {
      return;
    }

    await unlink(resolve(process.cwd(), "uploads", fileName)).catch(() => {
      // The database delete is the source of truth; missing local files are harmless.
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
