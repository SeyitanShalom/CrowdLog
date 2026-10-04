import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { AddEventReviewerDto } from "./dto/add-event-reviewer.dto";
import { CreateEventDto } from "./dto/create-event.dto";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { TemplateFieldInputDto } from "./dto/template-field-input.dto";
import { UpdateEventDto } from "./dto/update-event.dto";
import { UpdateEventMemberDto } from "./dto/update-event-member.dto";
import { EventsService } from "./events.service";

@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get("health")
  health() {
    return { status: "ok", service: "crowdlog-api" };
  }

  @Get("events")
  @UseGuards(AuthGuard)
  listEvents(@CurrentUser() user: AuthenticatedUser) {
    return this.eventsService.listEvents(user.id);
  }

  @Post("events")
  @UseGuards(AuthGuard)
  createEvent(@Body() dto: CreateEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.eventsService.createEvent(dto, user.id);
  }

  @Get("events/:eventId")
  @UseGuards(AuthGuard)
  getEvent(
    @Param("eventId") eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.getEvent(eventId, user.id);
  }

  @Delete("events/:eventId")
  @UseGuards(AuthGuard)
  deleteEvent(
    @Param("eventId") eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.deleteEvent(eventId, user.id);
  }

  @Patch("events/:eventId")
  @UseGuards(AuthGuard)
  updateEvent(
    @Param("eventId") eventId: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.updateEvent(eventId, dto, user.id);
  }

  @Post("events/:eventId/members")
  @UseGuards(AuthGuard)
  addReviewer(
    @Param("eventId") eventId: string,
    @Body() dto: AddEventReviewerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.addReviewer(eventId, dto, user.id);
  }

  @Delete("events/:eventId/members/:memberId")
  @UseGuards(AuthGuard)
  removeMember(
    @Param("eventId") eventId: string,
    @Param("memberId") memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.removeMember(eventId, memberId, user.id);
  }

  @Patch("events/:eventId/members/:memberId")
  @UseGuards(AuthGuard)
  updateMember(
    @Param("eventId") eventId: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateEventMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.updateMemberRole(
      eventId,
      memberId,
      dto,
      user.id,
    );
  }

  @Post("events/:eventId/templates")
  @UseGuards(AuthGuard)
  createTemplate(
    @Param("eventId") eventId: string,
    @Body() dto: CreateTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.createTemplate(eventId, dto, user.id);
  }

  @Post("templates/:templateId/fields")
  @UseGuards(AuthGuard)
  createTemplateField(
    @Param("templateId") templateId: string,
    @Body() dto: TemplateFieldInputDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.createTemplateField(templateId, dto, user.id);
  }
}
