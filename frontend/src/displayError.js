/**
 * Purpose: the words a screen shows for an error. The check that raised it is unchanged.
 * A sentence that is not in this list is shown exactly as it arrived, unless it is a raw
 * database or API error. Those are replaced so the screen never shows them.
 */

const RAW_DATABASE_OR_API = /postgres|duplicate key|violates |PGRST|JWT |syntax error at|null value in column "|relation "|stack trace|ECONNREFUSED|supabase/i;

const ERROR_TEXT = {
  'Request failed': 'Something went wrong. Please try again.',
  'Authentication required': 'Please sign in again.',
  'Invalid or expired token': 'Your session has expired. Please sign in again.',
  'Route not found': 'That page could not be found.',
  'Decision must be APPROVE or REJECT': 'Choose approve or reject.',
  'startAt and endAt must be provided together': 'Enter both a start and an end.',
  'startAt must be before endAt': 'The start must be before the end.',
  'startAt and endAt are required': 'Enter a start and an end.',
  'endAt must be after startAt': 'The end must be after the start.',
  'from and to are required': 'Enter both a start and an end.',
  'from and to must be valid dates': 'Enter a valid start and end.',
  'from must be before to': 'The start must be before the end.',
  'capacityMin must be a number': 'Minimum capacity must be a number.',
  'eventId and venueId are required': 'Choose an event and a venue.',
  'eventId is required': 'Choose an event.',
  'equipmentId is required': 'Choose an equipment item.',
  'quantity must be a whole number of at least 1': 'Quantity must be a whole number of at least 1.',
  'startAt must be a valid ISO date': 'Enter a valid start date and time.',
  'endAt must be a valid ISO date': 'Enter a valid end date and time.',
  'reason is required': 'A reason is required.',
  'Setup minutes must be a number': 'Setup minutes must be a number.',
  'Teardown minutes must be a number': 'Teardown minutes must be a number.',
};

export function displayError(input) {
  const text = typeof input === 'string' ? input : (input && input.message) || '';
  if (!text) return '';
  if (ERROR_TEXT[text]) return ERROR_TEXT[text];
  if (RAW_DATABASE_OR_API.test(text)) return 'Something went wrong. Please try again.';
  return text;
}

/** Venue forms list one message per field. The field key stays off the screen. */
export function displayFieldErrors(err) {
  if (Array.isArray(err?.details) && err.details.length) {
    const messages = err.details
      .map((detail) => displayError(detail?.message))
      .filter(Boolean);
    if (messages.length) return messages.join(' ');
  }
  return displayError(err);
}
