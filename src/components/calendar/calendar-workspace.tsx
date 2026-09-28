"use client";

import { type KeyboardEvent, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { saveCollaboratorAction } from "@/app/(dashboard)/collaboration/actions";
import {
  deleteCalendarEventAction,
  removeCalendarCollaboratorAction,
  saveCalendarCollaboratorsAction,
  saveCalendarEventAction,
} from "@/app/(dashboard)/calendar/actions";
import {
  CalendarMonthGrid,
  getCalendarMonthWeeks,
  formatCalendarDateValue,
  isSameCalendarDay,
  parseCalendarDateValue,
} from "@/components/calendar/calendar-month-grid";
import {
  CollaboratorDialog,
  type CollaboratorForm,
} from "@/components/collaboration/collaborator-dialog";
import { CollaboratorPickerDialog } from "@/components/collaboration/collaborator-picker-dialog";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  EventDialog,
  type CalendarFormState,
  type CalendarType,
  type EventTone,
} from "@/components/calendar/event-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RichTextContent, richTextToPlainText } from "@/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  CalendarView,
  CalendarEventRecord,
  SaveCalendarEventInput,
} from "@/lib/calendar";
import type { CollaboratorRecord } from "@/lib/collaboration";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

type CalendarWorkspaceProps = {
  initialEvents: CalendarEventRecord[];
  initialView: CalendarView;
  initialDate?: string;
  focusedEventId?: string;
  availableCollaborators: CollaboratorRecord[];
  assignedCollaborators: CollaboratorRecord[];
  canCreateEvents: boolean;
  canManageCollaborators: boolean;
};

const hours = Array.from({ length: 9 }, (_, index) => 9 + index);
const hourHeight = 74;
const calendarTypes: CalendarType[] = ["Projects", "Events", "Reminders", "Payments"];
const today = new Date();

function resolveInitialDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return today;
  }

  return parseCalendarDateValue(value);
}

const toneClasses: Record<
  EventTone,
  { card: string; edge: string; dot: string; text: string }
> = {
  green: {
    card: "bg-[#d5efd0]",
    edge: "bg-[#36b227]",
    dot: "bg-[#36b227]",
    text: "text-[#31952a]",
  },
  purple: {
    card: "bg-[#dccaf8]",
    edge: "bg-[#8d39ff]",
    dot: "bg-[#8d39ff]",
    text: "text-[#8039eb]",
  },
  blue: {
    card: "bg-[#cfe7fb]",
    edge: "bg-[#2d99f3]",
    dot: "bg-[#2d99f3]",
    text: "text-[#2b87df]",
  },
  amber: {
    card: "bg-[#f9ecd0]",
    edge: "bg-[#ea9d1a]",
    dot: "bg-[#ea9d1a]",
    text: "text-[#c97f07]",
  },
};

const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const monthGridLabel = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
});

const eventDetailDateLabel = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getWeekDays(anchor: Date) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function formatWeekTitle(anchor: Date) {
  const days = getWeekDays(anchor);
  const first = days[0];
  const last = days[6];
  const month = first.toLocaleDateString("en-US", { month: "long" });
  const endMonth = last.toLocaleDateString("en-US", { month: "long" });

  if (first.getMonth() === last.getMonth()) {
    return `${month} ${first.getDate()}-${last.getDate()}, ${last.getFullYear()}`;
  }

  return `${month} ${first.getDate()}-${endMonth} ${last.getDate()}, ${last.getFullYear()}`;
}

function getIsoWeekNumber(date: Date) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil((((copy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getEventMinutes(time: string) {
  const [hoursPart, minutesPart] = time.split(":").map(Number);
  return hoursPart * 60 + minutesPart;
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function getDefaultForm(date: string, start = "09:00", end = "10:00"): CalendarFormState {
  return {
    title: "",
    details: "",
    date,
    start,
    end,
    calendar: "Projects",
    tone: "green",
  };
}

function compareEvents(left: CalendarEventRecord, right: CalendarEventRecord) {
  return parseCalendarDateValue(left.date).getTime() - parseCalendarDateValue(right.date).getTime() ||
    getEventMinutes(left.start) - getEventMinutes(right.start);
}

function buildWeekOptions(anchor: Date) {
  const currentWeekStart = startOfWeek(anchor);

  return Array.from({ length: 9 }, (_, index) => {
    const date = addDays(currentWeekStart, (index - 4) * 7);

    return {
      value: formatCalendarDateValue(date),
      label: `Week ${getIsoWeekNumber(date)} • ${formatWeekTitle(date)}`,
    };
  });
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CalendarWorkspace({
  initialEvents,
  initialView,
  initialDate,
  focusedEventId,
  availableCollaborators,
  assignedCollaborators,
  canCreateEvents,
  canManageCollaborators,
}: CalendarWorkspaceProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => resolveInitialDate(initialDate));
  const [view, setView] = useState<CalendarView>(initialView);
  const [events, setEvents] = useState<CalendarEventRecord[]>([...initialEvents].sort(compareEvents));
  const [availableCollaboratorRecords, setAvailableCollaboratorRecords] =
    useState<CollaboratorRecord[]>(availableCollaborators);
  const [assignedCollaboratorRecords, setAssignedCollaboratorRecords] =
    useState<CollaboratorRecord[]>(assignedCollaborators);
  const [filters, setFilters] = useState<Record<CalendarType, boolean>>({
    Projects: true,
    Events: true,
    Reminders: true,
    Payments: true,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [dialogSaving, setDialogSaving] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("Create event");
  const [collaboratorDialogOpen, setCollaboratorDialogOpen] = useState(false);
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const [collaboratorDialogError, setCollaboratorDialogError] = useState<string>();
  const [collaboratorPickerError, setCollaboratorPickerError] = useState<string>();
  const [collaboratorDialogSaving, setCollaboratorDialogSaving] = useState(false);
  const [collaboratorPickerSaving, setCollaboratorPickerSaving] = useState(false);
  const [pickerSelectedCollaboratorIds, setPickerSelectedCollaboratorIds] = useState<string[]>(
    () => assignedCollaborators.map((collaborator) => collaborator.id),
  );
  const [eventPendingDelete, setEventPendingDelete] = useState<CalendarEventRecord | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRecord | null>(null);
  const [eventDeletePending, setEventDeletePending] = useState(false);
  const [eventDeleteError, setEventDeleteError] = useState<string>();
  const [collaboratorPendingRemoval, setCollaboratorPendingRemoval] =
    useState<CollaboratorRecord | null>(null);
  const [collaboratorRemovalPending, setCollaboratorRemovalPending] = useState(false);
  const [collaboratorRemovalError, setCollaboratorRemovalError] = useState<string>();
  const [collaboratorForm, setCollaboratorForm] = useState<CollaboratorForm>({
    name: "",
    email: "",
  });
  const [form, setForm] = useState<CalendarFormState>(
    getDefaultForm(formatCalendarDateValue(today)),
  );

  const visibleEvents = useMemo(
    () => events.filter((event) => filters[event.calendar]).sort(compareEvents),
    [events, filters],
  );
  const weekDays = getWeekDays(selectedDate);
  const monthWeeks = getCalendarMonthWeeks(selectedDate);
  const activeWeekLabel = formatWeekTitle(selectedDate);
  const activeWeekNumber = getIsoWeekNumber(selectedDate);
  const weekOptions = buildWeekOptions(selectedDate);

  const upcomingEvents = useMemo(
    () =>
      visibleEvents
        .filter((event) => {
          const eventDateTime = new Date(`${event.date}T${event.start}:00`);
          return eventDateTime >= new Date();
        })
        .slice(0, 5),
    [visibleEvents],
  );
  const visibleCollaborators = useMemo(
    () =>
      [...assignedCollaboratorRecords].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    [assignedCollaboratorRecords],
  );
  const calendarCollaboratorOptions = useMemo(
    () => availableCollaboratorRecords,
    [availableCollaboratorRecords],
  );
  const assignedCollaboratorIds = useMemo(
    () => visibleCollaborators.map((collaborator) => collaborator.id),
    [visibleCollaborators],
  );
  const activeFilterCount = useMemo(
    () => Object.values(filters).filter(Boolean).length,
    [filters],
  );

  function setFormValue<K extends keyof CalendarFormState>(
    field: K,
    value: CalendarFormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setCollaboratorFormValue<K extends keyof CollaboratorForm>(
    field: K,
    value: CollaboratorForm[K],
  ) {
    setCollaboratorForm((current) => ({ ...current, [field]: value }));
  }

  function openCollaboratorDialog() {
    setCollaboratorPickerOpen(false);
    setCollaboratorPickerError(undefined);
    setCollaboratorForm({
      name: "",
      email: "",
    });
    setCollaboratorDialogError(undefined);
    setTimeout(() => {
      setCollaboratorDialogOpen(true);
    }, 0);
  }

  function toggleAssignedCollaborator(collaboratorId: string) {
    const availableCollaborator = availableCollaboratorRecords.find(
      (collaborator) => collaborator.id === collaboratorId,
    );

    if (!availableCollaborator) {
      return;
    }

    setPickerSelectedCollaboratorIds((current) => {
      const exists = current.includes(collaboratorId);

      if (exists) {
        return current.filter((id) => id !== collaboratorId);
      }

      return [...current, collaboratorId];
    });
  }

  async function saveAssignedCollaborators() {
    setCollaboratorPickerSaving(true);
    setCollaboratorPickerError(undefined);

    try {
      const result = await saveCalendarCollaboratorsAction(pickerSelectedCollaboratorIds);

      if ("error" in result) {
        setCollaboratorPickerError(result.error);
        showErrorToast("Unable to update calendar collaborators.", result.error);
        return;
      }

      setAssignedCollaboratorRecords(result.collaborators);
      setPickerSelectedCollaboratorIds(result.collaborators.map((collaborator) => collaborator.id));
      setCollaboratorPickerOpen(false);
      showSuccessToast("Calendar collaborators updated.");
    } catch {
      showErrorToast(
        "Unable to update calendar collaborators.",
        "Unable to update the calendar collaborators right now. Please try again.",
      );
      setCollaboratorPickerError(
        "Unable to update the calendar collaborators right now. Please try again.",
      );
    } finally {
      setCollaboratorPickerSaving(false);
    }
  }

  async function saveCollaborator() {
    if (!collaboratorForm.name.trim() || !collaboratorForm.email.trim()) {
      setCollaboratorDialogError("Enter both collaborator name and email.");
      showErrorToast("Unable to save collaborator.", "Enter both collaborator name and email.");
      return;
    }

    setCollaboratorDialogSaving(true);
    setCollaboratorDialogError(undefined);

    try {
      const result = await saveCollaboratorAction(collaboratorForm);

      if ("error" in result) {
        setCollaboratorDialogError(result.error);
        showErrorToast("Unable to save collaborator.", result.error);
        return;
      }

      setAvailableCollaboratorRecords((current) => [...current, result.collaborator]);
      const calendarResult = await saveCalendarCollaboratorsAction([
        ...pickerSelectedCollaboratorIds,
        result.collaborator.id,
      ]);

      if ("error" in calendarResult) {
        setCollaboratorDialogError(calendarResult.error);
        showErrorToast("Unable to update calendar collaborators.", calendarResult.error);
        return;
      }

      setAssignedCollaboratorRecords(calendarResult.collaborators);
      setPickerSelectedCollaboratorIds(
        calendarResult.collaborators.map((collaborator) => collaborator.id),
      );
      setCollaboratorDialogOpen(false);
      setCollaboratorPickerOpen(false);
      showSuccessToast("Collaborator added to the calendar.");
    } catch {
      showErrorToast(
        "Unable to save collaborator.",
        "Unable to save the collaborator right now. Please try again.",
      );
      setCollaboratorDialogError(
        "Unable to save the collaborator right now. Please try again.",
      );
    } finally {
      setCollaboratorDialogSaving(false);
    }
  }

  async function confirmRemoveCollaborator() {
    if (!collaboratorPendingRemoval) {
      return;
    }

    setCollaboratorRemovalPending(true);
    setCollaboratorRemovalError(undefined);

    try {
      const result = await removeCalendarCollaboratorAction(collaboratorPendingRemoval.id);

      if ("error" in result) {
        setCollaboratorRemovalError(result.error);
        showErrorToast("Unable to remove collaborator.", result.error);
        return;
      }

      setAssignedCollaboratorRecords(result.collaborators);
      setPickerSelectedCollaboratorIds(result.collaborators.map((collaborator) => collaborator.id));
      setCollaboratorPendingRemoval(null);
      showSuccessToast("Collaborator removed from the calendar.");
    } catch {
      const message = "Unable to remove the collaborator right now. Please try again.";
      setCollaboratorRemovalError(message);
      showErrorToast("Unable to remove collaborator.", message);
    } finally {
      setCollaboratorRemovalPending(false);
    }
  }

  function openDialog(date: Date, start = "09:00", end = "10:00") {
    if (!canCreateEvents) {
      showErrorToast(
        "Calendar is read-only.",
        "You do not have permission to create calendar events.",
      );
      return;
    }

    setDialogError(undefined);
    setDialogTitle("Create event");
    setForm(getDefaultForm(formatCalendarDateValue(date), start, end));
    setDialogOpen(true);
  }

  async function saveEvent() {
    setDialogError(undefined);
    setDialogSaving(true);

    const payload: SaveCalendarEventInput = {
      title: form.title,
      details: form.details,
      date: form.date,
      start: form.start,
      end: form.end,
      calendar: form.calendar,
      tone: form.tone,
    };

    try {
      const result = await saveCalendarEventAction(payload);

      if (!("event" in result)) {
        setDialogError(result.error);
        return;
      }

      setEvents((current) => [...current, result.event].sort(compareEvents));
      setSelectedDate(parseCalendarDateValue(result.event.date));
      setDialogOpen(false);
    } catch {
      setDialogError("Unable to save the event right now. Please try again.");
    } finally {
      setDialogSaving(false);
    }
  }

  function requestDeleteEvent(event: CalendarEventRecord) {
    setEventDeleteError(undefined);
    setEventPendingDelete(event);
  }

  function openEventDetails(event: CalendarEventRecord) {
    setSelectedEvent(event);
  }

  function handleEventKeyDown(
    keyEvent: KeyboardEvent<HTMLElement>,
    event: CalendarEventRecord,
  ) {
    if (keyEvent.key !== "Enter" && keyEvent.key !== " ") {
      return;
    }

    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    openEventDetails(event);
  }

  async function confirmDeleteEvent() {
    if (!eventPendingDelete) {
      return;
    }

    setEventDeletePending(true);
    setEventDeleteError(undefined);

    try {
      const result = await deleteCalendarEventAction(eventPendingDelete.id);

      if ("error" in result) {
        setEventDeleteError(result.error);
        showErrorToast("Unable to delete event.", result.error);
        return;
      }

      setEvents((current) =>
        current.filter((event) => event.id !== result.deletedEventId),
      );
      setSelectedEvent((current) =>
        current?.id === result.deletedEventId ? null : current,
      );
      setEventPendingDelete(null);
      showSuccessToast("Calendar event deleted.");
    } catch {
      const message = "Unable to delete the event right now. Please try again.";
      setEventDeleteError(message);
      showErrorToast("Unable to delete event.", message);
    } finally {
      setEventDeletePending(false);
    }
  }

  function moveCalendar(direction: "prev" | "next") {
    const offset = direction === "next" ? 1 : -1;

    setSelectedDate((current) => {
      if (view === "month") {
        return new Date(current.getFullYear(), current.getMonth() + offset, 1);
      }

      if (view === "day") {
        return addDays(current, offset);
      }

      return addDays(current, offset * 7);
    });
  }

  function toggleFilter(type: CalendarType) {
    setFilters((current) => ({ ...current, [type]: !current[type] }));
  }

  function renderEventDeleteButton(
    event: CalendarEventRecord,
    options?: {
      className?: string;
      iconClassName?: string;
      titlePrefix?: string;
    },
  ) {
    if (!event.canDelete) {
      return null;
    }

    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={
          options?.className ??
          "size-7 shrink-0 rounded-full text-[#7f877f] hover:bg-[#fff3f1] hover:text-[#bb4d49]"
        }
        aria-label={`Delete ${event.title}`}
        title={`${options?.titlePrefix ?? "Delete"} ${event.title}`}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          requestDeleteEvent(event);
        }}
        onDoubleClick={(clickEvent) => {
          clickEvent.stopPropagation();
        }}
      >
        <Trash2 className={options?.iconClassName ?? "h-3.5 w-3.5"} />
      </Button>
    );
  }

  function renderEventDetailsDialog() {
    if (!selectedEvent) {
      return null;
    }

    const tone = toneClasses[selectedEvent.tone];
    const eventDate = parseCalendarDateValue(selectedEvent.date);

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[#112118]/45 px-4 py-8"
        onClick={() => setSelectedEvent(null)}
      >
        <Card
          className="w-full max-w-[520px] rounded-[28px] p-0 shadow-[0_35px_90px_rgba(11,26,18,0.22)]"
          onClick={(clickEvent) => clickEvent.stopPropagation()}
        >
          <CardHeader className="flex-row items-start justify-between gap-4 pb-0">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                <Badge
                  variant="secondary"
                  className={`rounded-full px-3 py-1 text-[11px] font-[700] ${tone.card} ${tone.text}`}
                >
                  {selectedEvent.calendar}
                </Badge>
              </div>
              <CardTitle className="truncate text-[24px]">
                {selectedEvent.title}
              </CardTitle>
              <p className="mt-1 text-[14px] text-[#6a706b]">
                Event details
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setSelectedEvent(null)}
              variant="secondary"
              size="icon"
              className="shrink-0 border border-line text-[#253029]"
              aria-label="Close event details"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>

          <CardContent className="p-6 pt-5">
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-[18px] border border-line bg-[#f8faf7] px-4 py-3">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <div>
                  <p className="text-[12px] font-[700] uppercase tracking-[0.08em] text-[#7a837b]">
                    Date
                  </p>
                  <p className="mt-1 text-[14px] font-[600] text-[#1b241e]">
                    {eventDetailDateLabel.format(eventDate)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-[18px] border border-line bg-[#f8faf7] px-4 py-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <div>
                  <p className="text-[12px] font-[700] uppercase tracking-[0.08em] text-[#7a837b]">
                    Time
                  </p>
                  <p className="mt-1 text-[14px] font-[600] text-[#1b241e]">
                    {selectedEvent.start} - {selectedEvent.end}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-[18px] border border-line bg-[#f8faf7] px-4 py-3">
                <Tag className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <div>
                  <p className="text-[12px] font-[700] uppercase tracking-[0.08em] text-[#7a837b]">
                    Calendar
                  </p>
                  <p className="mt-1 text-[14px] font-[600] text-[#1b241e]">
                    {selectedEvent.calendar}
                  </p>
                </div>
              </div>

              {selectedEvent.createdByName || selectedEvent.createdByEmail ? (
                <div className="flex items-start gap-3 rounded-[18px] border border-line bg-[#f8faf7] px-4 py-3">
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <div className="min-w-0">
                    <p className="text-[12px] font-[700] uppercase tracking-[0.08em] text-[#7a837b]">
                      Created by
                    </p>
                    <p className="mt-1 min-w-0 whitespace-normal break-words text-[14px] font-[600] text-[#1b241e]">
                      {selectedEvent.createdByName ?? selectedEvent.createdByEmail}
                    </p>
                    {selectedEvent.createdByEmail ? (
                      <p className="mt-0.5 truncate text-[12px] text-[#6a706b]">
                        {selectedEvent.createdByEmail}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {selectedEvent.details ? (
              <div className="mt-4 rounded-[18px] border border-line bg-white px-4 py-3">
                <p className="text-[12px] font-[700] uppercase tracking-[0.08em] text-[#7a837b]">
                  Description
                </p>
                <RichTextContent value={selectedEvent.details} className="mt-2 text-[14px] leading-relaxed text-[#2f3a32]" />
              </div>
            ) : null}

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
              {selectedEvent.canDelete ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="border border-[#f1c7c1] px-6 text-[15px] text-[#bb4d49] hover:bg-[#fff3f1]"
                  onClick={() => requestDeleteEvent(selectedEvent)}
                >
                  Delete Event
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => setSelectedEvent(null)}
                size="lg"
                className="px-7 text-[15px]"
              >
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderHeaderControls() {
    return (
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              onClick={() => moveCalendar("prev")}
              variant="ghost"
              size="icon"
              className="size-10 text-brand"
              aria-label="Previous range"
            >
              <ChevronLeft className="h-7 w-7" />
            </Button>
            <Button
              type="button"
              onClick={() => moveCalendar("next")}
              variant="ghost"
              size="icon"
              className="size-10 text-brand"
              aria-label="Next range"
            >
              <ChevronRight className="h-7 w-7" />
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <h2 className="text-[18px] font-[700] tracking-[-0.03em] text-[#121713] sm:text-[20px]">
              {view === "month"
                ? monthLabel.format(selectedDate)
                : view === "day"
                  ? monthGridLabel.format(selectedDate)
                  : activeWeekLabel}
            </h2>
            {view === "week" ? (
              <div className="min-w-[230px]">
                <Select
                  value={formatCalendarDateValue(startOfWeek(selectedDate))}
                  onValueChange={(value) => setSelectedDate(parseCalendarDateValue(value))}
                >
                  <SelectTrigger className="min-h-[38px] text-[13px] font-[600] shadow-[0_8px_18px_rgba(18,34,25,0.06)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {weekOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Tabs value={view} onValueChange={(value) => setView(value as CalendarView)}>
            <TabsList>
              {(["week", "day", "month"] as CalendarView[]).map((option) => (
                <TabsTrigger key={option} value={option}>
                  {option}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {canCreateEvents ? (
            <Button
              type="button"
              onClick={() => openDialog(selectedDate)}
              className="min-h-[42px] gap-2 px-6 text-[14px]"
            >
              Create <Plus className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderMiniCalendar() {
    return (
      <Card className="rounded-[20px]">
        <CardContent className="p-4">
          <CalendarMonthGrid
            month={selectedDate}
            selectedDate={selectedDate}
            onMonthChange={setSelectedDate}
            onSelect={setSelectedDate}
            markerDates={new Set(visibleEvents.map((event) => event.date))}
            compact
          />
        </CardContent>
      </Card>
    );
  }

  function renderUpcomingSchedules() {
    return (
      <Card className="rounded-[20px]">
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px]">Upcoming Schedules</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
        {upcomingEvents.length > 0 ? (
          <ul className="space-y-3">
            {upcomingEvents.map((event) => {
              const tone = toneClasses[event.tone];
              const isFocused = focusedEventId === event.id;

              return (
                <li
                  key={event.id}
                  role="button"
                  tabIndex={0}
                  className={`flex items-start gap-2.5 rounded-[14px] p-2 transition-colors ${
                    isFocused ? "bg-brand-soft ring-2 ring-brand/25" : ""
                  } cursor-pointer hover:bg-[#f7fbf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30`}
                  onClick={() => openEventDetails(event)}
                  onKeyDown={(keyEvent) => handleEventKeyDown(keyEvent, event)}
                >
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[11px] leading-[1.25] ${tone.text}`}>
                      {event.title} {event.details ? `- ${richTextToPlainText(event.details)}` : ""}
                    </p>
                    <p className="mt-1 text-[10px] text-[#7f877f]">
                    {monthGridLabel.format(parseCalendarDateValue(event.date))} at {event.start}
                    </p>
                  </div>
                  {renderEventDeleteButton(event)}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-[#7f877f]">No upcoming schedules yet.</p>
        )}
        </CardContent>
      </Card>
    );
  }

  function renderCalendarFilters() {
    return (
      <Card className="rounded-[20px]">
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px]">My Calendar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 pt-0">
          {calendarTypes.map((type) => (
            <Button
              key={type}
              type="button"
              onClick={() => toggleFilter(type)}
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-0 py-0 text-[13px] font-normal text-[#253029]"
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-[4px] border ${
                  filters[type]
                    ? "border-brand bg-white text-brand"
                    : "border-line bg-white text-transparent"
                }`}
              >
                <Check className="h-3 w-3" />
              </span>
              {type}
            </Button>
          ))}
        </CardContent>
      </Card>
    );
  }

  function renderCollaborators() {
    return (
      <Card className="rounded-[20px]">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-[13px]">Collaborators</CardTitle>
          {canManageCollaborators ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-brand"
              onClick={() => {
                setCollaboratorDialogOpen(false);
                setCollaboratorDialogError(undefined);
                setCollaboratorPickerError(undefined);
                setPickerSelectedCollaboratorIds(assignedCollaboratorIds);
                setCollaboratorPickerOpen(true);
              }}
              aria-label="Add collaborator"
              title="Add collaborator"
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="pt-0">
          {visibleCollaborators.length > 0 ? (
            <ul className="space-y-3">
              {visibleCollaborators.map((collaborator) => {
                return (
                  <li key={collaborator.id} className="flex items-center gap-2.5">
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-[linear-gradient(145deg,#f0dcc4,#b58257)] text-[11px] font-[700] text-white">
                      {getInitials(collaborator.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="min-w-0 whitespace-normal break-words text-[13px] font-[600] text-[#232c26]">
                        {collaborator.name}
                      </p>
                      <p className="text-[10px] text-[#50b848]">
                        Shared calendar
                      </p>
                    </div>
                    {canManageCollaborators ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 rounded-full text-[#7f877f] hover:bg-[#fff3f1] hover:text-[#bb4d49]"
                        aria-label={`Remove ${collaborator.name}`}
                        title={`Remove ${collaborator.name}`}
                        onClick={() => {
                          setCollaboratorRemovalError(undefined);
                          setCollaboratorPendingRemoval(collaborator);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[12px] text-[#7f877f]">
              No collaborators currently have calendar access.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  function renderWeekOrDayView(dayCount: number) {
    const days = dayCount === 1 ? [selectedDate] : weekDays;
    const boardHeight = hours.length * hourHeight;

    return (
      <div className="rounded-[24px] bg-[#f7f8f5] p-4 sm:p-5">
        <div
          className="grid gap-0 border-b border-[#dde4dc] pb-4"
          style={{ gridTemplateColumns: `64px repeat(${dayCount}, minmax(0, 1fr))` }}
        >
          <div />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="border-l border-[#dde4dc] px-3 text-center first:border-l"
            >
              <p className="text-[12px] font-[700] uppercase text-[#1b211d]">
                {day.toLocaleDateString("en-US", { weekday: "short" })}
              </p>
              <p className="mt-1 text-[18px] font-[700] tracking-[-0.03em] text-[#111712]">
                {day.getDate()}
              </p>
            </div>
          ))}
        </div>

        <div className="relative mt-3">
          <div className="absolute left-0 top-0 w-[64px]">
            {hours.map((hour) => (
              <div
                key={hour}
                className="flex h-[74px] items-start justify-start pr-3 pt-3 text-[11px] text-[#576059]"
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>

          <div
            className="ml-[64px] grid overflow-hidden rounded-[18px] bg-[#eef2ef]"
            style={{
              gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
              height: boardHeight,
            }}
          >
            {days.map((day) => {
              const dayKey = formatCalendarDateValue(day);
              const dayEvents = visibleEvents.filter((event) => event.date === dayKey);

              return (
                <div key={dayKey} className="relative border-l border-[#dbe2dc] first:border-l-0">
                  {hours.map((hour) =>
                    canCreateEvents ? (
                      <button
                        key={`${dayKey}-${hour}`}
                        type="button"
                        onClick={() =>
                          openDialog(
                            day,
                            `${String(hour).padStart(2, "0")}:00`,
                            `${String(hour + 1).padStart(2, "0")}:00`,
                          )
                        }
                        onDoubleClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openDialog(
                            day,
                            `${String(hour).padStart(2, "0")}:00`,
                            `${String(hour + 1).padStart(2, "0")}:00`,
                          );
                        }}
                        className="block h-[74px] w-full cursor-pointer border-t border-[#dbe2dc] text-left transition-colors first:border-t-0 hover:bg-white/35"
                        aria-label={`Add event on ${dayKey} at ${formatHour(hour)}`}
                      />
                    ) : (
                      <div
                        key={`${dayKey}-${hour}`}
                        className="block h-[74px] w-full border-t border-[#dbe2dc] first:border-t-0"
                      />
                    ),
                  )}

                  {dayEvents.map((event) => {
                    const tone = toneClasses[event.tone];
                    const isFocused = focusedEventId === event.id;
                    const top = ((getEventMinutes(event.start) - hours[0] * 60) / 60) * hourHeight;
                    const height =
                      ((getEventMinutes(event.end) - getEventMinutes(event.start)) / 60) * hourHeight;

                    return (
                      <div
                        key={event.id}
                        role="button"
                        tabIndex={0}
                        className={`absolute left-1.5 right-1.5 overflow-hidden rounded-[14px] ${tone.card} ${
                          isFocused ? "ring-2 ring-brand/45 ring-offset-2 ring-offset-[#eef2ef]" : ""
                        } cursor-pointer transition-shadow hover:shadow-[0_10px_22px_rgba(22,45,28,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45`}
                        style={{ top: `${top}px`, height: `${height}px` }}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openEventDetails(event);
                        }}
                        onDoubleClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                        }}
                        onKeyDown={(keyEvent) => handleEventKeyDown(keyEvent, event)}
                      >
                        <div className={`absolute inset-y-0 left-0 w-1.5 ${tone.edge}`} />
                        <div className="px-3 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-[11px] font-[600] leading-[1.2] ${tone.text}`}>
                              {event.title}
                            </p>
                            {renderEventDeleteButton(event, {
                              className:
                                "size-6 shrink-0 rounded-full text-[#5e6b62] hover:bg-white/70 hover:text-[#bb4d49]",
                              iconClassName: "h-3.5 w-3.5",
                            })}
                          </div>
                          {event.details ? (
                            <p className="mt-1 line-clamp-2 text-[10px] text-[#5e6b62]">{richTextToPlainText(event.details)}</p>
                          ) : null}
                          <p className={`mt-3 text-[10px] ${tone.text}`}>
                            {event.start} - {event.end}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function renderMonthView() {
    return (
      <div className="rounded-[24px] bg-[#f7f8f5] p-4 sm:p-5">
        <div className="grid grid-cols-7 gap-3 border-b border-[#dde4dc] pb-3">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div
              key={day}
              className="text-center text-[12px] font-[700] uppercase text-[#1b211d]"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-3">
          {monthWeeks.map((week) => (
            <div key={week[0].toISOString()} className="grid grid-cols-7 gap-3">
              {week.map((date) => {
                const dayKey = formatCalendarDateValue(date);
                const dayEvents = visibleEvents.filter((event) => event.date === dayKey);
                const active = isSameCalendarDay(date, selectedDate);

                return (
                  <div
                    key={dayKey}
                    className={`min-h-[126px] rounded-[18px] border p-3 transition-colors ${
                      active
                        ? "border-brand bg-[#edf7ef]"
                        : "border-[#e2e7e1] bg-white hover:border-brand/30"
                    }`}
                    onDoubleClick={() => {
                      setSelectedDate(date);
                      openDialog(date);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate(date);
                        if (canCreateEvents) {
                          openDialog(date);
                        }
                      }}
                      className="block w-full text-left"
                    >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[13px] font-[700] ${
                          date.getMonth() === selectedDate.getMonth()
                            ? "text-[#131813]"
                            : "text-[#a7aea8]"
                        }`}
                      >
                        {date.getDate()}
                      </span>
                      {dayEvents.length > 0 ? (
                        <Badge variant="secondary" className="rounded-full bg-brand-soft px-2 py-1 text-[10px] font-[600] text-brand">
                          {dayEvents.length}
                        </Badge>
                      ) : null}
                    </div>
                    </button>

                    <div className="mt-3 space-y-1.5">
                      {dayEvents.slice(0, 2).map((event) => {
                        const tone = toneClasses[event.tone];
                        const isFocused = focusedEventId === event.id;

                        return (
                          <div
                            key={event.id}
                            role="button"
                            tabIndex={0}
                            className={`flex items-center justify-between gap-1 rounded-full px-2.5 py-1 text-[10px] font-[600] ${tone.card} ${tone.text} ${
                              isFocused ? "ring-2 ring-brand/45 ring-offset-1 ring-offset-white" : ""
                            } cursor-pointer hover:shadow-[0_8px_16px_rgba(22,45,28,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation();
                              openEventDetails(event);
                            }}
                            onDoubleClick={(clickEvent) => {
                              clickEvent.stopPropagation();
                            }}
                            onKeyDown={(keyEvent) => handleEventKeyDown(keyEvent, event)}
                          >
                            <span className="truncate">
                              {event.start} {event.title}
                            </span>
                            {renderEventDeleteButton(event, {
                              className:
                                "size-5 shrink-0 rounded-full text-current hover:bg-white/70 hover:text-[#bb4d49]",
                              iconClassName: "h-3 w-3",
                              titlePrefix: "Delete",
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="space-y-4">
        <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-4">
            {renderMiniCalendar()}
            {renderUpcomingSchedules()}
            {renderCalendarFilters()}
            {renderCollaborators()}
          </div>

          <Card className="rounded-[28px] p-5 shadow-[0_22px_60px_rgba(23,39,28,0.06)] sm:p-6">
            {renderHeaderControls()}
            <div className="mt-5">
              {visibleEvents.length === 0 ? (
                <Card className="mb-4 rounded-[18px] border border-dashed border-[#dbe2dc] bg-[#f8faf7] px-4 py-3 shadow-none">
                  {activeFilterCount === 0
                    ? "All calendar filters are turned off."
                    : events.length > 0
                      ? "No calendar items match the current filters."
                      : canCreateEvents
                        ? "No calendar events yet. Use Create or click a date/timeslot to add your first event."
                        : "No calendar items to display. You have read-only access to this calendar."}
                </Card>
              ) : null}

              {view === "month" ? (
                renderMonthView()
              ) : (
                renderWeekOrDayView(view === "day" ? 1 : 7)
              )}
            </div>
            {view === "week" ? (
              <p className="mt-4 text-[12px] text-[#7a837b]">
                {canCreateEvents
                  ? `Week ${activeWeekNumber} selected. Click any timeslot to add a new event.`
                  : `Week ${activeWeekNumber} selected. You have read-only access to this calendar.`}
              </p>
            ) : null}
          </Card>
        </section>
      </section>

      <EventDialog
        form={form}
        error={dialogError}
        isOpen={dialogOpen}
        pending={dialogSaving}
        submitLabel="Save Event"
        title={dialogTitle}
        onChange={setFormValue}
        onClose={() => {
          setDialogError(undefined);
          setDialogOpen(false);
        }}
        onSubmit={saveEvent}
      />
      {renderEventDetailsDialog()}
      <CollaboratorDialog
        isOpen={collaboratorDialogOpen}
        mode="invite"
        form={collaboratorForm}
        error={collaboratorDialogError}
        saving={collaboratorDialogSaving}
        onClose={() => {
          setCollaboratorDialogError(undefined);
          setCollaboratorDialogOpen(false);
        }}
        onSubmit={saveCollaborator}
        onChange={setCollaboratorFormValue}
      />
      <CollaboratorPickerDialog
        isOpen={collaboratorPickerOpen}
        collaborators={calendarCollaboratorOptions}
        selectedIds={pickerSelectedCollaboratorIds}
        error={collaboratorPickerError}
        saving={collaboratorPickerSaving}
        onToggle={toggleAssignedCollaborator}
        onClose={() => {
          setCollaboratorPickerError(undefined);
          setPickerSelectedCollaboratorIds(assignedCollaboratorIds);
          setCollaboratorPickerOpen(false);
        }}
        onConfirm={saveAssignedCollaborators}
        onInviteFallback={openCollaboratorDialog}
        confirmLabel="Apply Selection"
      />
      <ConfirmationDialog
        isOpen={Boolean(collaboratorPendingRemoval)}
        title="Remove collaborator?"
        description="This collaborator will no longer have access to this calendar schedule."
        confirmLabel="Remove"
        tone="destructive"
        pending={collaboratorRemovalPending}
        error={collaboratorRemovalError}
        onConfirm={confirmRemoveCollaborator}
        onClose={() => {
          if (collaboratorRemovalPending) {
            return;
          }

          setCollaboratorRemovalError(undefined);
          setCollaboratorPendingRemoval(null);
        }}
      />
      <ConfirmationDialog
        isOpen={Boolean(eventPendingDelete)}
        title="Delete event?"
        description={
          eventPendingDelete
            ? `Delete "${eventPendingDelete.title}" from the calendar?`
            : ""
        }
        confirmLabel="Delete Event"
        tone="destructive"
        pending={eventDeletePending}
        error={eventDeleteError}
        onConfirm={confirmDeleteEvent}
        onClose={() => {
          if (eventDeletePending) {
            return;
          }

          setEventDeleteError(undefined);
          setEventPendingDelete(null);
        }}
      />
    </>
  );
}
