"use client";

const FORMAT_LOCALE = "en-US";
const FORMAT_TIME_ZONE = "UTC";

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: FORMAT_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

const dateOptions: Intl.DateTimeFormatOptions = {
  timeZone: FORMAT_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
};

const timeOptions: Intl.DateTimeFormatOptions = {
  timeZone: FORMAT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(FORMAT_LOCALE, dateTimeOptions);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(FORMAT_LOCALE, dateOptions);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(FORMAT_LOCALE, timeOptions);
}