/**
 * Notion calendar types and helpers for SMM PLANNING database.
 * Data is synced from Notion and stored in data/notion-calendar.json.
 */

export type NotionCalendarEvent = {
  id: string;
  name: string;
  eventName?: string;
  eventType?: string[];
  eventDate?: string;
  eventPage?: string;
  region?: string;
  time?: string;
  ownerIds?: string[];
  ownerNames?: string[];
};

export type NotionCalendarEntry = {
  id: string;
  notionUrl: string;
  name: string;
  date: string;
  content: string;
  event?: NotionCalendarEvent;
  tags?: string[];
  /** When true, content/Event/Tags missing - author should be tagged in Notion */
  needsAuthorInput: boolean;
  /** When true, event place/time is missing - author should be tagged in Notion */
  needsEventDetails: boolean;
  /** Author user IDs to tag when needsAuthorInput or needsEventDetails */
  authorIdsToTag: string[];
};

export type NotionCalendarData = {
  syncedAt: string;
  entries: NotionCalendarEntry[];
};

export function getWeekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function getEntriesForWeek(entries: NotionCalendarEntry[], weekStart: Date): NotionCalendarEntry[] {
  const { start, end } = getWeekRange(weekStart);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  return entries.filter((e) => e.date >= startStr && e.date <= endStr);
}

function getMonthKey(monthDate: Date): string {
  const year = monthDate.getFullYear();
  const month = String(monthDate.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getEntriesForMonth(entries: NotionCalendarEntry[], monthDate: Date): NotionCalendarEntry[] {
  const monthKey = `${getMonthKey(monthDate)}-`;
  return entries
    .filter((entry) => entry.date.startsWith(monthKey))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
