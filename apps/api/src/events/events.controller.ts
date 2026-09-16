import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreateEventDto } from "./dto/create-event.dto";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { TemplateFieldInputDto } from "./dto/template-field-input.dto";
import { EventsService } from "./events.service";

@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get("health")
  health() {
    return { status: "ok", service: "crowdlog-api" };
  }

  @Get("events")
  listEvents() {
    return this.eventsService.listEvents();
  }

  @Post("events")
  createEvent(@Body() dto: CreateEventDto) {
    return this.eventsService.createEvent(dto);
  }

  @Get("events/:eventId")
  getEvent(@Param("eventId") eventId: string) {
    return this.eventsService.getEvent(eventId);
  }

  @Post("events/:eventId/templates")
  createTemplate(
    @Param("eventId") eventId: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.eventsService.createTemplate(eventId, dto);
  }

  @Post("templates/:templateId/fields")
  createTemplateField(
    @Param("templateId") templateId: string,
    @Body() dto: TemplateFieldInputDto,
  ) {
    return this.eventsService.createTemplateField(templateId, dto);
  }
}
