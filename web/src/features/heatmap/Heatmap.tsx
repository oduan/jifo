export type HeatmapCell = {
  date: string;
  noteCount: number;
};

type HeatmapProps = {
  cells: HeatmapCell[];
};

export function Heatmap({ cells }: HeatmapProps) {
  return (
    <section aria-label="笔记热力图">
      <div
        style={{
          display: 'grid',
          gridTemplateRows: 'repeat(7, 12px)',
          gridAutoFlow: 'column',
          gridAutoColumns: '12px',
          gap: 4
        }}
      >
        {cells.map((cell) => {
          const label = `${cell.noteCount} 条笔记于 ${cell.date}`;
          const opacity = Math.min(1, 0.18 + cell.noteCount * 0.22);
          return (
            <div
              key={cell.date}
              aria-label={label}
              title={label}
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: cell.noteCount > 0 ? `rgba(22, 163, 74, ${opacity})` : '#e5e7eb'
              }}
            />
          );
        })}
      </div>
    </section>
  );
}
