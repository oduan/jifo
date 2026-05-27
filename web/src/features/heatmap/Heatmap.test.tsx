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
});
