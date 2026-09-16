import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateEventDto } from "./dto/create-event.dto";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { TemplateFieldInputDto } from "./dto/template-field-input.dto";
import {
  getEventInclude,
  toEventResponse,
  toFieldResponse,
  toTemplateResponse,
} from "./event-response.mapper";
import { toPrismaFieldType } from "./field-type.mapper";

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents() {
    const events = await this.prisma.event.findMany({
      orderBy: { createdAt: "desc" },
      include: getEventInclude(),
    });

    return events.map(toEventResponse);
  }

  async getEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: getEventInclude(),
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    return toEventResponse(event);
  }

  async createEvent(dto: CreateEventDto) {
    const fields = dto.fields ?? [];

    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        eventDate: dto.eventDate ? new Date(dto.eventDate) : undefined,
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

  async createTemplate(eventId: string, dto: CreateTemplateDto) {
    await this.getEvent(eventId);

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

  async createTemplateField(templateId: string, dto: TemplateFieldInputDto) {
    const template = await this.prisma.attendanceTemplate.findUnique({
      where: { id: templateId },
      include: { fields: true },
    });

    if (!template) {
      throw new NotFoundException("Attendance template not found.");
    }

    const field = await this.prisma.templateField.create({
      data: {
        ...this.toTemplateFieldCreateInput(dto, template.fields.length),
        templateId,
      },
    });

    return toFieldResponse(field);
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
}
