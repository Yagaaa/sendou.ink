import { getWeek } from "date-fns";

// TODO: when this lands https://github.com/remix-run/remix/discussions/7768 we can get rid of this (utilizing Kysely plugin to do converting from/to Date for us)
export function databaseTimestampToDate(timestamp: number) {
  return new Date(timestamp * 1000);
}

export function dateToDatabaseTimestamp(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

export function databaseCreatedAt() {
  return dateToDatabaseTimestamp(new Date());
}

export function dateToWeekNumber(date: Date) {
  return getWeek(date, { weekStartsOn: 1, firstWeekContainsDate: 4 });
}

export function dateToThisWeeksMonday(date: Date) {
  const copiedDate = new Date(date.getTime());

  while (copiedDate.getDay() !== 1) {
    copiedDate.setDate(copiedDate.getDate() - 1);
  }

  return copiedDate;
}

export function getWeekStartsAtMondayDay(date: Date) {
  const currentDay = date.getDay();

  return dayToWeekStartsAtMondayDay(currentDay);
}

export function dayToWeekStartsAtMondayDay(day: number) {
  return day === 0 ? 7 : day;
}

// https://stackoverflow.com/a/71336659
export function weekNumberToDate({
  week,
  year,
  position = "start",
}: {
  week: number;
  year: number;
  /** start = Date of Monday, end = Date of Sunday */
  position?: "start" | "end";
}) {
  const result = new Date(Date.UTC(year, 0, 4));

  result.setDate(
    result.getDate() - (result.getDay() || 7) + 1 + 7 * (week - 1),
  );
  if (position === "end") {
    result.setDate(result.getDate() + 6);
  }
  return result;
}

/**
 * Checks if a date is valid or not.
 *
 * Returns:
 * - True if date is valid
 * - False otherwise
 */
export function isValidDate(date: Date) {
  return !isNaN(date.getTime());
}

/** Returns date as a string with the format YYYY-MM-DDThh:mm in user's time zone */
export function dateToYearMonthDayHourMinuteString(date: Date) {
  const copiedDate = new Date(date.getTime());

  if (!isValidDate(copiedDate)) {
    throw new Error("tried to format string from invalid date");
  }

  const year = copiedDate.getFullYear();
  const month = copiedDate.getMonth() + 1;
  const day = copiedDate.getDate();
  const hour = copiedDate.getHours();
  const minute = copiedDate.getMinutes();

  return `${year}-${prefixZero(month)}-${prefixZero(day)}T${prefixZero(
    hour,
  )}:${prefixZero(minute)}`;
}

/** Returns date as a string with the format YYYY-MM-DD in user's time zone */
export function dateToYearMonthDayString(date: Date) {
  const copiedDate = new Date(date.getTime());

  if (!isValidDate(copiedDate)) {
    throw new Error("tried to format string from invalid date");
  }

  const year = copiedDate.getFullYear();
  const month = copiedDate.getMonth() + 1;
  const day = copiedDate.getDate();

  return `${year}-${prefixZero(month)}-${prefixZero(day)}`;
}

function prefixZero(number: number) {
  return number < 10 ? `0${number}` : number;
}

/**
 * Retrieves a new Date object that is offset by several hours.
 *
 * NOTE: it is important that we work with & return a copy of the date here,
 *  otherwise we will just be mutating the original date passed into this function.
 */
export function getDateWithHoursOffset(date: Date, hoursOffset: number) {
  const copiedDate = new Date(date.getTime());
  copiedDate.setHours(date.getHours() + hoursOffset);
  return copiedDate;
}

export function getDateAtNextFullHour(date: Date) {
  const copiedDate = new Date(date.getTime());
  if (date.getMinutes() > 0) {
    copiedDate.setHours(date.getHours() + 1);
    copiedDate.setMinutes(0);
  }
  copiedDate.setSeconds(0);
  return copiedDate;
}
