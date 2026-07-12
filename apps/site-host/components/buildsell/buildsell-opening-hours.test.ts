import { describe, expect, it } from 'vitest';
import { parseOpeningHours } from './buildsell-opening-hours';

describe('parseOpeningHours', () => {
  it('parses a single day range', () => {
    expect(parseOpeningHours('Mon–Fri 7am–6pm')).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        opens: '07:00',
        closes: '18:00',
      },
    ]);
  });

  it('parses "Open 24/7" as every day, all hours', () => {
    const result = parseOpeningHours('Open 24/7');
    expect(result).toHaveLength(7);
    expect(result[0]).toEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday'],
      opens: '00:00',
      closes: '23:59',
    });
    expect(result.map((r) => r.dayOfWeek[0])).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
  });

  it('parses "24 hours" and "always open" variants', () => {
    expect(parseOpeningHours('24 hours')).toHaveLength(7);
    expect(parseOpeningHours('Always Open')).toHaveLength(7);
  });

  it('parses multi-segment hours separated by comma/semicolon', () => {
    const result = parseOpeningHours('Mon-Fri 8:00am-5:00pm, Sat 9am-2pm');
    expect(result).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        opens: '08:00',
        closes: '17:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Saturday'],
        opens: '09:00',
        closes: '14:00',
      },
    ]);
  });

  it('parses a single-day segment', () => {
    expect(parseOpeningHours('Sunday 10am–2pm')).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Sunday'],
        opens: '10:00',
        closes: '14:00',
      },
    ]);
  });

  it('returns [] for unparseable text', () => {
    expect(parseOpeningHours('Call for hours')).toEqual([]);
    expect(parseOpeningHours('')).toEqual([]);
  });

  it('skips a segment that fails to parse without dropping the rest', () => {
    const result = parseOpeningHours('By appointment, Sat 9am-2pm');
    expect(result).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Saturday'],
        opens: '09:00',
        closes: '14:00',
      },
    ]);
  });
});
