import { describe, expect, test } from 'vitest';

import { browserTimeZone, localISODate } from '../../shared/time';
import { loadHeatmap } from './api';

describe('heatmap API', () => {
  test('uses local calendar dates without converting them through UTC', () => {
    expect(localISODate(new Date(2026, 4, 30, 23, 30))).toBe('2026-05-30');
  });

  test('sends the browser IANA timezone for server-side day boundaries', async () => {
    const calls: string[] = [];
    const client = {
      request: async <T>(path: string): Promise<T> => {
        calls.push(path);
        return { days: [] } as T;
      }
    };

    await loadHeatmap(client, { from: '2026-05-01', to: '2026-05-31' });

    const query = new URL(calls[0], 'https://jifo.test').searchParams;
    expect(query.get('from')).toBe('2026-05-01');
    expect(query.get('to')).toBe('2026-05-31');
    expect(query.get('timezone')).toBe(browserTimeZone());
  });
});
