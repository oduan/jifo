import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NotesPage } from './NotesPage';

describe('NotesPage', () => {
  test('渲染主布局并支持标签筛选笔记流', async () => {
    const user = userEvent.setup();

    render(
      <NotesPage
        userName="oisin"
        notes={[
          {
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '工作笔记' }],
            tagIds: ['work']
          },
          {
            id: 'n2',
            createdAt: '2026-05-26',
            blocks: [{ type: 'paragraph', content: '生活笔记' }],
            tagIds: ['life']
          }
        ]}
        tags={[
          { id: 'work', name: '工作', noteCount: 1 },
          { id: 'life', name: '生活', noteCount: 1 }
        ]}
        heatmapCells={[
          { date: '2026-05-27', noteCount: 1 },
          { date: '2026-05-26', noteCount: 1 }
        ]}
      />
    );

    expect(screen.getByText('全部笔记')).toBeInTheDocument();
    expect(screen.getByText('全部标签')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索笔记' })).toBeInTheDocument();
    expect(screen.getByLabelText('1 条笔记于 2026-05-27')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '工作 (1)' }));

    expect(screen.getByText('工作笔记')).toBeInTheDocument();
    expect(screen.queryByText('生活笔记')).not.toBeInTheDocument();
  });

  test('点击新笔记可以打开编辑器', async () => {
    const user = userEvent.setup();

    render(
      <NotesPage userName="oisin" notes={[]} tags={[]} heatmapCells={[]} onCreateNote={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: '新笔记' }));
    expect(screen.getByLabelText('笔记内容')).toBeInTheDocument();
  });
});
