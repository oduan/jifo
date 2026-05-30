import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Heatmap } from './Heatmap';

describe('Heatmap', () => {
  test('渲染每日格子并提供 hover/可访问提示', () => {
    render(
      <Heatmap
        cells={[
          { date: '2026-05-26', noteCount: 0 },
          { date: '2026-05-27', noteCount: 3 }
        ]}
      />
    );

    expect(screen.getByLabelText('0 条笔记于 2026-05-26')).toBeInTheDocument();
    expect(screen.getByLabelText('3 条笔记于 2026-05-27')).toHaveAttribute(
      'title',
      '3 条笔记于 2026-05-27'
    );
  });

  test('不再通过 1fr inline 列宽拉伸格子', () => {
    const { container } = render(
      <Heatmap
        cells={[
          { date: '2026-05-26', noteCount: 0 },
          { date: '2026-05-27', noteCount: 3 },
          { date: '2026-05-28', noteCount: 1 },
          { date: '2026-05-29', noteCount: 2 },
          { date: '2026-05-30', noteCount: 0 },
          { date: '2026-05-31', noteCount: 0 },
          { date: '2026-06-01', noteCount: 0 },
          { date: '2026-06-02', noteCount: 1 }
        ]}
      />
    );

    expect(container.querySelector('.heatmap-grid')).not.toHaveAttribute('style');
  });
});
