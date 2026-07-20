import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NoteCard } from './NoteCard';

describe('NoteCard', () => {
  test('显示精确到秒的创建时间', () => {
    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-30 01:02:03',
          blocks: [{ type: 'paragraph', content: '时间测试' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText('2026-05-30 01:02:03')).toBeInTheDocument();
  });

  test('默认折叠并可展开/收起', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '1\n2\n3\n4\n5\n6\n7' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument();
  });

  test('折叠判断按实际显示行计算，不计算空行', () => {
    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '一\n\n二\n\n三\n\n四\n\n五\n\n六' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '展开' })).not.toBeInTheDocument();
  });

  test('非空行超过 6 行时折叠且折叠内容保留空行结构', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '一\n\n二\n\n三\n\n四\n\n五\n\n六\n\n七' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText('六')).toBeInTheDocument();
    expect(screen.queryByText('七')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByText('七')).toBeInTheDocument();
  });

  test('进入编辑模式后隐藏展开/收起开关', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '1\n2\n3\n4\n5\n6\n7' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '编辑' }));

    expect(screen.getByLabelText('笔记内容')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '展开' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起' })).not.toBeInTheDocument();
  });

  test('编辑模式下笔记块变为输入框样式，提供取消和发送', async () => {
    const user = userEvent.setup();

    const { container } = render(
      <NoteCard
        note={{ id: 'n1', createdAt: '2026-05-27', blocks: [{ type: 'paragraph', content: '原内容' }], tagIds: [] }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.dblClick(screen.getByText('原内容'));

    expect(container.querySelector('.note-card')).toHaveClass('note-card--editing');
    expect(container.querySelector('.note-card__header')).not.toBeInTheDocument();
    expect(screen.getByLabelText('笔记内容')).toHaveFocus();
    expect(screen.getByRole('button', { name: '取消编辑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送笔记' })).toBeInTheDocument();
  });

  test('双击进入编辑状态', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '原内容' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.dblClick(screen.getByText('原内容'));
    expect(screen.getByLabelText('笔记内容')).toBeInTheDocument();
  });

  test('菜单删除可触发回调', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '原内容' }],
          tagIds: []
        }}
        onDelete={onDelete}
        onUpdate={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: '更多操作' });
    expect(trigger).toHaveClass('note-menu__trigger');

    await user.click(trigger);
    expect(screen.getByRole('button', { name: '编辑' })).toHaveClass('dropdown-menu__item');
    expect(screen.getByRole('button', { name: '删除' })).toHaveClass('dropdown-menu__item');

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(onDelete).toHaveBeenCalledWith('n1');
  });

  test('从菜单进入编辑后可通过发送按钮左侧的取消按钮退出', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{ id: 'n1', createdAt: '2026-05-27', blocks: [{ type: 'paragraph', content: '原内容' }], tagIds: [] }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '编辑' }));

    const cancelButton = screen.getByRole('button', { name: '取消编辑' });
    expect(cancelButton).toHaveTextContent('取消');
    expect(cancelButton.nextElementSibling).toHaveAccessibleName('发送笔记');

    await user.click(cancelButton);
    expect(screen.queryByLabelText('笔记内容')).not.toBeInTheDocument();
    expect(screen.getByText('原内容')).toBeInTheDocument();
  });

  test('点击外部区域后关闭三个点菜单', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <NoteCard
          note={{
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '原内容' }],
            tagIds: []
          }}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
        />
        <button type="button">外部按钮</button>
      </div>
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '外部按钮' }));

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  test('按 Escape 后关闭三个点菜单', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '原内容' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  test('视口底部空间不足时菜单向上展开', async () => {
    const user = userEvent.setup();
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const element = this as HTMLElement;
      if (element.classList.contains('note-menu__panel')) {
        return { top: 690, bottom: 780, left: 0, right: 108, width: 108, height: 90, x: 0, y: 690, toJSON: () => ({}) };
      }
      if (element.classList.contains('note-menu')) {
        return { top: 680, bottom: 704, left: 0, right: 24, width: 24, height: 24, x: 0, y: 680, toJSON: () => ({}) };
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    });

    render(
      <NoteCard
        note={{ id: 'n1', createdAt: '2026-05-27', blocks: [{ type: 'paragraph', content: '底部笔记' }], tagIds: [] }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByRole('menu')).toHaveClass('note-menu__panel--up');
    rectSpy.mockRestore();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  });

  test('焦点移到外部元素后关闭三个点菜单', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <NoteCard
          note={{
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '原内容' }],
            tagIds: []
          }}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
        />
        <button type="button">外部按钮</button>
      </div>
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();

    await user.tab();
    await user.tab();
    await user.tab();

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  test('正文标签渲染为可点击的小标签', async () => {
    const user = userEvent.setup();
    const onTagSelect = vi.fn();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '今天处理 #工作/前端 的交互细节' }],
          tagIds: ['工作/前端']
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        onTagSelect={onTagSelect}
      />
    );

    const tag = screen.getByRole('button', { name: '#工作/前端' });

    expect(tag).toHaveClass('note-card__tag');
    expect(screen.getByText(/今天处理/)).toBeInTheDocument();
    expect(screen.getByText(/的交互细节/)).toBeInTheDocument();

    await user.click(tag);

    expect(onTagSelect).toHaveBeenCalledWith('工作/前端');
  });

  test('渲染常见 Markdown 格式', () => {
    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '## 标题\n\n**粗体**、*斜体*、~~删除线~~、`代码`和[链接](https://example.com)\n\n- 列表项' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument();
    expect(screen.getByText('粗体').tagName).toBe('STRONG');
    expect(screen.getByText('斜体').tagName).toBe('EM');
    expect(screen.getByText('删除线').tagName).toBe('DEL');
    expect(screen.getByText('代码').tagName).toBe('CODE');
    expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute('target', '_blank');
  });

  test('普通列表和任务列表混排时保留普通项目标记', () => {
    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '- 普通项目\n- [ ] 任务项目' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const plainItem = screen.getByText('普通项目').closest('li');
    const taskItem = screen.getByText('任务项目').closest('li');
    expect(plainItem).not.toHaveClass('task-list-item');
    expect(plainItem?.closest('ul')).toHaveClass('contains-task-list');
    expect(taskItem).toHaveClass('task-list-item');
  });

  test('点击任意任务框会更新对应的原始 Markdown 标记', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '- [ ] 待办\n- [x] 已完成' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: '标记任务为未完成' }));
    expect(onUpdate).toHaveBeenCalledWith('n1', [{ type: 'paragraph', content: '- [ ] 待办\n- [ ] 已完成' }]);
  });

  test('图片显示在底部缩略图栏并可打开和关闭大图预览', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [
            { type: 'paragraph', content: '带图片的笔记' },
            { type: 'image', url: 'blob:photo', alt: 'photo.png' }
          ],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const thumbnailButton = screen.getByRole('button', { name: '放大预览 photo.png' });
    expect(thumbnailButton.closest('.note-card__images')).toBeInTheDocument();

    await user.click(thumbnailButton);
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument();
  });
});
