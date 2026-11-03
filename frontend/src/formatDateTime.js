// Shown times are always Singapore (UTC+8), in one shape: "3 Nov 2026, 10:00".
// Stored values stay UTC. datetime-local inputs still use the laptop clock, which
// matches this when the laptop is set to Singapore.

const TIME_ZONE = 'Asia/Singapore';

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value) {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatDate(value) {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatTime(value) {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function singaporeDateKey(value) {
  const date = asDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function formatMonth(value) {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    month: 'long',
    year: 'numeric',
  }).format(date);
}
