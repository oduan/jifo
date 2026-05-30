export type HeatmapCell = {
  date: string;
  noteCount: number;
};

type HeatmapProps = {
  cells: HeatmapCell[];
};

function levelForCount(noteCount: number) {
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

export function Heatmap({ cells }: HeatmapProps) {
  return (
    <section className="heatmap" aria-label="笔记热力图">
      <div className="heatmap-grid">
        {cells.map((cell) => {
          const label = `${cell.noteCount} 条笔记于 ${cell.date}`;
          return <div key={cell.date} className="heatmap-cell" data-level={levelForCount(cell.noteCount)} aria-label={label} title={label} />;
        })}
      </div>
    </section>
  );
}
