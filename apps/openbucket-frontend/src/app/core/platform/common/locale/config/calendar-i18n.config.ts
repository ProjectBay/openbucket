import type { BrnCalendarI18n } from '@spartan-ng/brain/calendar';
import type { LocaleCode } from '../store/locale.store';

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const DE_MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

const EN_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const DE_WEEKDAYS = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
];

const yearsRange = (start?: number, end?: number): number[] => {
  const current = new Date().getFullYear();
  const s = start ?? current - 100;
  const e = end ?? current + 100;
  return Array.from({ length: e - s + 1 }, (_, i) => s + i);
};

type Months12 = [
  string, string, string, string, string, string,
  string, string, string, string, string, string,
];

export const EN_CALENDAR_I18N: BrnCalendarI18n = {
  formatWeekdayName: (i) => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][i],
  formatHeader: (m, y) => `${EN_MONTHS[m]} ${y}`,
  formatYear: (y) => y.toString(),
  formatMonth: (m) => EN_MONTHS[m],
  labelPrevious: () => 'Previous month',
  labelNext: () => 'Next month',
  labelWeekday: (i) => EN_WEEKDAYS[i],
  months: () => [...EN_MONTHS] as Months12,
  years: yearsRange,
  firstDayOfWeek: () => 0,
};

export const DE_CALENDAR_I18N: BrnCalendarI18n = {
  formatWeekdayName: (i) => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][i],
  formatHeader: (m, y) => `${DE_MONTHS[m]} ${y}`,
  formatYear: (y) => y.toString(),
  formatMonth: (m) => DE_MONTHS[m],
  labelPrevious: () => 'Vorheriger Monat',
  labelNext: () => 'Nächster Monat',
  labelWeekday: (i) => DE_WEEKDAYS[i],
  months: () => [...DE_MONTHS] as Months12,
  years: yearsRange,
  firstDayOfWeek: () => 1,
};

export const CALENDAR_I18N_CONFIGS: Record<LocaleCode, BrnCalendarI18n> = {
  en: EN_CALENDAR_I18N,
  de: DE_CALENDAR_I18N,
};
