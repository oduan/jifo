import { ApiClient } from '../../shared/api/client';
import { HeatmapCell } from './Heatmap';

type ApiHeatmapDay = {
  date: string;
  createdCount: number;
  updatedCount: number;
  totalCount: number;
};

type HeatmapResponse = {
  days: ApiHeatmapDay[];
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function defaultHeatmapRange(days = 84) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - days + 1);
  return { from: isoDate(from), to: isoDate(to) };
}

export async function loadHeatmap(client: ApiClient, range = defaultHeatmapRange()): Promise<HeatmapCell[]> {
  const params = new URLSearchParams(range);
  const response = await client.request<HeatmapResponse>(`/heatmap?${params.toString()}`);
  return response.days.map((day) => ({ date: day.date, noteCount: day.totalCount }));
}
