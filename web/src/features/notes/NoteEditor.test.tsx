import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NoteEditor } from './NoteEditor';

describe('NoteEditor', () => {
  test('默认使用紧凑高度并可通过纸飞机按钮提交 paragraph blocks', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} />);

    const textarea = screen.getByLabelText('笔记内容');
    expect(textarea).toHaveAttribute('rows', '2');
    expect(textarea).toHaveStyle({ height: '44px' });

    const sendButton = screen.getByRole('button', { name: '发送笔记' });
    expect(sendButton).toBeDisabled();

    await user.type(textarea, '第一段\n\n第二段');
    expect(sendButton).toBeEnabled();
    await user.click(sendButton);

    expect(onSubmit).toHaveBeenCalledWith([
      { type: 'paragraph', content: '第一段' },
      { type: 'paragraph', content: '第二段' }
    ]);
  });

  test('按 Ctrl+Enter 可直接发送笔记', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} />);

    const textarea = screen.getByLabelText('笔记内容');
    await user.type(textarea, '快捷发送');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onSubmit).toHaveBeenCalledWith([{ type: 'paragraph', content: '快捷发送' }]);
    expect(textarea).toHaveValue('');
  });

  test('回车自动续写普通列表和任务列表，空列表项再次回车退出列表', async () => {
    const user = userEvent.setup();
    render(<NoteEditor onSubmit={vi.fn()} />);
    const textarea = screen.getByLabelText('笔记内容');

    await user.type(textarea, '- 第一项{Enter}');
    expect(textarea).toHaveValue('- 第一项\n- ');

    await user.type(textarea, '{Enter}');
    expect(textarea).toHaveValue('- 第一项\n');

    const taskText = '- 第一项\n- [x] 完成项';
    fireEvent.change(textarea, { target: { value: taskText, selectionStart: taskText.length, selectionEnd: taskText.length } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea).toHaveValue('- 第一项\n- [x] 完成项\n- [ ] ');
  });

  test('聚焦时自动展开输入框', async () => {
    const user = userEvent.setup();

    render(<NoteEditor onSubmit={vi.fn()} />);

    const textarea = screen.getByLabelText('笔记内容');
    expect(textarea).toHaveStyle({ height: '44px' });
    await user.click(textarea);
    expect(textarea).toHaveStyle({ height: '68px' });
  });

  test('输入独立 # 后显示标签下拉并可用键盘选择插入', async () => {
    const user = userEvent.setup();

    render(
      <NoteEditor
        tags={[
          { id: 'test', name: '测试', path: '测试' },
          { id: 'work', name: '工作', path: '工作/前端' },
          { id: 'life', name: '生活', path: '生活' }
        ]}
        onSubmit={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText('笔记内容');
    await user.type(textarea, '记录 #');

    expect(screen.getByRole('listbox', { name: '标签建议' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '测试' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}{Enter}');

    expect(textarea).toHaveValue('记录 #工作/前端 ');
    expect(screen.queryByRole('listbox', { name: '标签建议' })).not.toBeInTheDocument();
  });

  test('键盘移动选中标签时会自动滚动到可见区域', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <NoteEditor
        tags={Array.from({ length: 12 }, (_, index) => ({ id: `tag-${index}`, name: `标签${index}`, path: `标签${index}` }))}
        onSubmit={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText('笔记内容');
    await user.type(textarea, '#');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');

    expect(screen.getByRole('option', { name: '标签3' })).toHaveAttribute('aria-selected', 'true');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    delete (window.HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  test('标签下拉不显示仅存在于回收站或已彻底删除笔记中的标签', async () => {
    const user = userEvent.setup();

    render(
      <NoteEditor
        tags={[
          { id: 'active', name: '使用中', path: '使用中', noteCount: 1 },
          { id: 'deleted', name: '已删除', path: '已删除', noteCount: 0 }
        ]}
        onSubmit={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText('笔记内容');
    await user.type(textarea, '#');

    expect(screen.getByRole('option', { name: '使用中' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '已删除' })).not.toBeInTheDocument();

    await user.type(textarea, '已删除');
    expect(screen.getByRole('option', { name: '已删除 新建' })).toBeInTheDocument();
  });

  test('光标离开输入框时关闭标签建议，重新聚焦到 # 后再次打开', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <NoteEditor tags={[{ id: 'test', name: '测试', path: '测试' }]} onSubmit={vi.fn()} />
        <button type="button">外部按钮</button>
      </div>
    );

    const textarea = screen.getByLabelText('笔记内容');
    await user.type(textarea, '#');
    expect(screen.getByRole('listbox', { name: '标签建议' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '外部按钮' }));
    expect(screen.queryByRole('listbox', { name: '标签建议' })).not.toBeInTheDocument();

    await user.click(textarea);
    expect(screen.getByRole('listbox', { name: '标签建议' })).toBeInTheDocument();
  });

  test('删除文字后输入框高度会随内容减少而缩小', () => {
    render(<NoteEditor onSubmit={vi.fn()} />);

    const textarea = screen.getByLabelText('笔记内容');
    let measuredHeight = 150;
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => measuredHeight });

    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: '第一行\n第二行\n第三行\n第四行' } });
    expect(textarea).toHaveStyle({ height: '150px' });

    measuredHeight = 74;
    fireEvent.change(textarea, { target: { value: '短内容' } });
    expect(textarea).toHaveStyle({ height: '74px' });
  });

  test('没有匹配标签时显示可新建的输入词', async () => {
    const user = userEvent.setup();

    render(<NoteEditor tags={[{ id: 'test', name: '测试', path: '测试' }]} onSubmit={vi.fn()} />);

    const textarea = screen.getByLabelText('笔记内容');
    await user.type(textarea, ' #新标签');

    const option = screen.getByRole('option', { name: '新标签 新建' });
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('新建')).toHaveClass('note-editor__tag-suggestion-badge');

    await user.keyboard('{Enter}');
    expect(textarea).toHaveValue(' #新标签 ');
  });

  test('标签下拉会根据 # 后输入实时过滤，且非独立 # 不触发', async () => {
    const user = userEvent.setup();

    render(
      <NoteEditor
        tags={[
          { id: 'test', name: '测试', path: '测试' },
          { id: 'test1', name: '测试1', path: '测试1' },
          { id: 'work', name: '工作', path: '工作/前端' }
        ]}
        onSubmit={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText('笔记内容');
    await user.type(textarea, 'abc#');
    expect(screen.queryByRole('listbox', { name: '标签建议' })).not.toBeInTheDocument();

    await user.clear(textarea);
    await user.type(textarea, ' #1');

    expect(screen.getByRole('option', { name: '测试1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '测试' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '工作/前端' })).not.toBeInTheDocument();
  });

  test('提交后清空内容、恢复默认高度，并禁用发送按钮', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} />);

    const textarea = screen.getByLabelText('笔记内容');
    await user.type(textarea, '提交后清空');
    await user.click(screen.getByRole('button', { name: '发送笔记' }));

    expect(onSubmit).toHaveBeenCalledWith([{ type: 'paragraph', content: '提交后清空' }]);
    expect(textarea).toHaveValue('');
    expect(textarea).toHaveAttribute('rows', '2');
    expect(screen.getByRole('button', { name: '发送笔记' })).toBeDisabled();
  });

  test('粘贴图片后可作为图片块提交', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onUploadImage = vi.fn(async () => ({ type: 'image' as const, mediaId: 'm1', url: 'blob:preview', alt: 'photo.png' }));
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    render(<NoteEditor onSubmit={onSubmit} onUploadImage={onUploadImage} />);

    const file = new File(['png'], 'photo.png', { type: 'image/png' });
    const textarea = screen.getByLabelText('笔记内容');
    const clipboardData = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }]
    };
    await user.click(textarea);
    fireEvent.paste(textarea, { clipboardData });
    const preview = await screen.findByAltText('photo.png');
    expect(preview.closest('.note-editor__image-tray')).toBeInTheDocument();
    expect(textarea).toHaveStyle({ height: '68px' });
    await user.click(screen.getByRole('button', { name: '发送笔记' }));

    expect(onUploadImage).toHaveBeenCalledWith(file);
    expect(onSubmit).toHaveBeenCalledWith([{ type: 'image', mediaId: 'm1', url: 'blob:preview', alt: 'photo.png' }]);
  });

  test('可从输入框图片栏移除待发送图片', async () => {
    const user = userEvent.setup();
    const onUploadImage = vi.fn(async () => ({ type: 'image' as const, mediaId: 'm1', url: 'blob:preview', alt: 'photo.png' }));
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    render(<NoteEditor onSubmit={vi.fn()} onUploadImage={onUploadImage} />);

    const file = new File(['png'], 'photo.png', { type: 'image/png' });
    const textarea = screen.getByLabelText('笔记内容');
    fireEvent.paste(textarea, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } });

    await user.click(await screen.findByRole('button', { name: '移除图片 photo.png' }));

    expect(screen.queryByAltText('photo.png')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送笔记' })).toBeDisabled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});
