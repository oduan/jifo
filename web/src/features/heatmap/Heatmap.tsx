export type HeatmapCell = {
  date: string;
  noteCount: number;
};

type HeatmapProps = {
  cells: HeatmapCell[];
};

const CELLS_PER_WEEK = 7;

function levelForCount(noteCount: number) {
  if (noteCount >= 8) {
    return 4;
  }
  if (noteCount >= 4) {
    return 3;
  }
  if (noteCount >= 2) {
    return 2;
  }
  if (noteCount >= 1) {
    return 1;
  }
  return 0;
}

function monthOfDate(date: string): number | null {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).getMonth() + 1;
}

export function Heatmap({ cells }: HeatmapProps) {
  let lastMonth: number | null = null;
  const columnCount = Math.ceil(cells.length / CELLS_PER_WEEK);
  const monthLabels = Array.from({ length: columnCount }, (_, columnIndex) => {
    const cell = cells[columnIndex * CELLS_PER_WEEK];
    const month = cell ? monthOfDate(cell.date) : null;
    if (month === null || month === lastMonth) {
      return '';
    }
    lastMonth = month;
    return `${month}月`;
  });

  return (
    <section className="heatmap" aria-label="笔记热力图">
      <div className="heatmap-months" aria-hidden="true">
        {monthLabels.map((label, index) => (
          <span key={index} className="heatmap-month">
            {label}
          </span>
        ))}
      </div>
      <div className="heatmap-grid">
        {cells.map((cell) => {
          const label = `${cell.noteCount} 条笔记于 ${cell.date}`;
          return <div key={cell.date} className="heatmap-cell" data-level={levelForCount(cell.noteCount)} aria-label={label} title={label} />;
        })}
      </div>
    </section>
  );
}
