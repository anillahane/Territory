import { formatInTimeZone } from 'date-fns-tz';

const INDIA_TIME_ZONE = 'Asia/Kolkata';
const INDIA_DATE_TIME_FORMAT = 'dd MMM yyyy HH:mm:ss';

export function formatIndiaDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return 'Unknown timestamp';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown timestamp';
  }

  return formatInTimeZone(date, INDIA_TIME_ZONE, INDIA_DATE_TIME_FORMAT);
}

