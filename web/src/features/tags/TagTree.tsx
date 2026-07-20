import { FormEvent, Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type TagNode = {
  id: string;
  name: string;
  noteCount: number;
  parentId?: string;
  path?: string;
};

type TagTreeProps = {
  tags: TagNode[];
  selectedTagId?: string | null;
  onSelect: (tagId: string) => void;
  onRename?: (tagId: string, path: string) => void | Promise<void>;
  onDelete?: (tagId: string, deleteNotes: boolean) => void | Promise<void>;
};

function hasVisibleSelfOrDescendant(tags: TagNode[], tag: TagNode): boolean {
  return tag.noteCount > 0 || tags.some((candidate) => candidate.parentId === tag.id && hasVisibleSelfOrDescendant(tags, candidate));
}

type RenderTagItemsOptions = {
  tags: TagNode[];
  parentId: string | undefined;
  selectedTagId?: string | null;
  expandedTagIds: Set<string>;
  menuTagId: string | null;
  onSelect: (tagId: string) => void;
  onToggle: (tagId: string) => void;
  onToggleMenu: (tagId: string, anchor: HTMLElement) => void;
};

function MenuIcon({ type }: { type: 'edit' | 'trash' | 'chevron' }) {
  if (type === 'edit') {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 14-.7 3.7L6 17l9.8-9.8-3-3L3 14Zm8.5-8.5 3 3M8 17h9" /></svg>;
  }
  if (type === 'trash') {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M7 5V2.8h6V5m2 0-1 13H6L5 5m3 3v6m4-6v6" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg>;
}

function renderTagItems(options: RenderTagItemsOptions): JSX.Element[] {
  const { tags, parentId, selectedTagId, expandedTagIds, menuTagId, onSelect, onToggle, onToggleMenu } = options;
  const children = tags.filter((tag) => tag.parentId === parentId && hasVisibleSelfOrDescendant(tags, tag));

  return children.flatMap((tag) => {
    const childItems = renderTagItems({ ...options, parentId: tag.id });

    if (tag.noteCount === 0) {
      return childItems.map((childItem, index) => <Fragment key={`${tag.id}-${index}`}>{childItem}</Fragment>);
    }

    const hasChildren = childItems.length > 0;
    const isExpanded = expandedTagIds.has(tag.id);
    const menuOpen = menuTagId === tag.id;

    return [
      <li key={tag.id}>
        <div className={['tag-row', hasChildren ? 'tag-row--has-children' : '', isExpanded ? 'tag-row--expanded' : '', menuOpen ? 'tag-row--menu-open' : ''].filter(Boolean).join(' ')}>
          {hasChildren ? (
            <button type="button" className="tag-expander" aria-label={`${isExpanded ? '收起' : '展开'} ${tag.name}`} aria-expanded={isExpanded} onClick={() => onToggle(tag.id)}>
              <svg className="sidebar-icon tag-expander__hash" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1 3.5 15M12.5 1 11 15M1.5 6h13M1 11h13" /></svg>
              <svg className="sidebar-icon tag-expander__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5-4.5 4.5" /></svg>
            </button>
          ) : (
            <span className="tag-prefix" aria-hidden="true"><svg className="sidebar-icon tag-prefix__icon" viewBox="0 0 16 16"><path d="M5 1 3.5 15M12.5 1 11 15M1.5 6h13M1 11h13" /></svg></span>
          )}
          <button type="button" className="tag-button" onClick={() => onSelect(tag.id)} aria-pressed={selectedTagId === tag.id} aria-label={`${tag.name} (${tag.noteCount})`}>
            <span>{tag.name}</span>
          </button>
          <div className="tag-row__trailing">
            <span className="tag-count" aria-hidden="true">{tag.noteCount}</span>
            <button type="button" className="tag-actions-trigger" aria-label={`${tag.name} 更多操作`} aria-expanded={menuOpen} onClick={(event) => { event.stopPropagation(); onToggleMenu(tag.id, event.currentTarget); }}>•••</button>
          </div>
        </div>
        {hasChildren && isExpanded ? <ul className="tag-list">{childItems}</ul> : null}
      </li>
    ];
  });
}

export function TagTree({ tags, selectedTagId, onSelect, onRename, onDelete }: TagTreeProps) {
  const [expandedTagIds, setExpandedTagIds] = useState<Set<string>>(() => new Set());
  const [menuTagId, setMenuTagId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [editingTag, setEditingTag] = useState<TagNode | null>(null);
  const [editPath, setEditPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const treeRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!treeRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuTagId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuTagId(null);
      setEditingTag(null);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const toggleTag = (tagId: string) => {
    setExpandedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const startEditing = (tag: TagNode) => {
    setEditingTag(tag);
    setEditPath(tag.path ?? tag.name);
    setEditError('');
    setMenuTagId(null);
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingTag || !editPath.trim() || !onRename) return;
    setBusy(true);
    setEditError('');
    try {
      await onRename(editingTag.id, editPath.trim());
      setEditingTag(null);
    } catch {
      setEditError('保存失败，请检查标签名称后重试。');
    } finally {
      setBusy(false);
    }
  };

  const deleteTag = async (tag: TagNode, deleteNotes: boolean) => {
    if (!onDelete) return;
    setBusy(true);
    try {
      await onDelete(tag.id, deleteNotes);
      setMenuTagId(null);
    } catch {
      // The workspace surfaces the request error; keep this interaction from creating an unhandled rejection.
    } finally {
      setBusy(false);
    }
  };

  const items = renderTagItems({
    tags,
    parentId: undefined,
    selectedTagId,
    expandedTagIds,
    menuTagId,
    onSelect,
    onToggle: toggleTag,
    onToggleMenu: (tagId, anchor) => {
      if (menuTagId === tagId) {
        setMenuTagId(null);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      setMenuPosition({
        top: Math.min(rect.top, window.innerHeight - 110),
        left: Math.min(rect.right + 6, window.innerWidth - 320)
      });
      setMenuTagId(tagId);
    }
  });
  const menuTag = menuTagId ? tags.find((tag) => tag.id === menuTagId) : undefined;

  return (
    <>
      <nav ref={treeRef} className="tag-tree" aria-label="全部标签">{items.length > 0 ? <ul className="tag-list">{items}</ul> : null}</nav>
      {menuTag && menuPosition ? createPortal(
        <div ref={menuRef} className="tag-actions-menu tag-actions-menu--portal" role="menu" aria-label={`${menuTag.name} 标签操作`} style={menuPosition}>
          <button type="button" role="menuitem" className="tag-actions-menu__item" disabled={busy} onClick={() => startEditing(menuTag)}>
            <MenuIcon type="edit" /><span>编辑名称</span>
          </button>
          <div className="tag-actions-menu__delete">
            <button type="button" role="menuitem" className="tag-actions-menu__item tag-actions-menu__item--danger" disabled={busy}>
              <MenuIcon type="trash" /><span>删除标签</span><MenuIcon type="chevron" />
            </button>
            <div className="tag-delete-submenu" role="menu" aria-label={`${menuTag.name} 删除选项`}>
              <button type="button" role="menuitem" disabled={busy} onClick={() => void deleteTag(menuTag, false)}>仅删除标签</button>
              <button type="button" role="menuitem" className="tag-delete-submenu__danger" disabled={busy} onClick={() => void deleteTag(menuTag, true)}>删除标签和笔记</button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
      {editingTag ? createPortal(
        <div className="tag-edit-modal" role="dialog" aria-modal="true" aria-label="编辑标签名称" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditingTag(null); }}>
          <form className="tag-edit-modal__panel" onSubmit={submitEdit}>
            <div className="tag-edit-modal__controls">
              <input autoFocus aria-label="标签名称" value={editPath} onChange={(event) => setEditPath(event.target.value)} disabled={busy} />
              <button type="submit" disabled={busy || !editPath.trim()}>保存</button>
            </div>
            <p>使用 标签/次级标签 格式创建<span>多级标签</span></p>
            {editError ? <div className="tag-edit-modal__error" role="alert">{editError}</div> : null}
          </form>
        </div>,
        document.body
      ) : null}
    </>
  );
}
