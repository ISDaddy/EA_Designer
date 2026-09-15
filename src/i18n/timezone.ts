// A practical, curated list of IANA time zones for the pickers (user profile, System Details,
// Integration Software) - not the full ~400-zone IANA database, which would be an unusably long
// dropdown, but a representative one covering every UTC offset and the world's major population
// centers/business hubs. "UTC" is first since it's the DB default for systems/software.
export const TIME_ZONE_OPTIONS: string[] = [
  'UTC',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Atlantic/Reykjavik',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Prague',
  'Europe/Vienna',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Warsaw',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Istanbul',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
];

// The browser's own IANA zone, e.g. "Europe/Prague" - the sensible default for a new user or a
// newly created system before anyone has picked one explicitly.
export const detectBrowserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

// A short, human label for a time zone: its city/region name plus current UTC offset, e.g.
// "Prague (UTC+02:00)" - used everywhere a zone is picked or displayed so raw IANA ids ("Europe/
// Prague") aren't the only cue.
export const timeZoneLabel = (timeZone: string): string => {
  const city = timeZone.split('/').pop()?.replace(/_/g, ' ') || timeZone;
  const offset = formatUtcOffset(timeZone);
  return `${city} (UTC${offset})`;
};

const formatUtcOffset = (timeZone: string): string => {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
    const part = dtf.formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
    const match = part.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!match) return '+00:00';
    const [, sign, hourDigits, minuteDigits] = match;
    return `${sign}${hourDigits.padStart(2, '0')}:${(minuteDigits || '00').padStart(2, '0')}`;
  } catch {
    return '+00:00';
  }
};

// Renders a Date in a specific IANA time zone using the given locale's date/time conventions -
// the building block for showing "your time" and "system time" side by side wherever the app
// displays a scheduled run or a downtime window.
export const formatInTimeZone = (date: Date, timeZone: string, locale: string): string => {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};
