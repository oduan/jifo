import { Fragment, useState } from 'react';

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
};

function hasVisibleSelfOrDescendant(tags: TagNode[], tag: TagNode): boolean {
  return tag.noteCount > 0 || tags.some((candidate) => candidate.parentId === tag.id && hasVisibleSelfOrDescendant(tags, candidate));
}

type RenderTagItemsOptions = {
  tags: TagNode[];
  parentId: string | undefined;
  selectedTagId?: string | null;
  expandedTagIds: Set<string>;
  onSelect: (tagId: string) => void;
  onToggle: (tagId: string) => void;
};

function renderTagItems({ tags, parentId, selectedTagId, expandedTagIds, onSelect, onToggle }: RenderTagItemsOptions): JSX.Element[] {
  const children = tags.filter((tag) => tag.parentId === parentId && hasVisibleSelfOrDescendant(tags, tag));

  return children.flatMap((tag) => {
    const childItems = renderTagItems({ tags, parentId: tag.id, selectedTagId, expandedTagIds, onSelect, onToggle });

    if (tag.noteCount === 0) {
      return childItems.map((childItem, index) => <Fragment key={`${tag.id}-${index}`}>{childItem}</Fragment>);
    }

    const hasChildren = childItems.length > 0;
    const isExpanded = expandedTagIds.has(tag.id);

    return [
      <li key={tag.id}>
        <div className={['tag-row', hasChildren ? 'tag-row--has-children' : '', isExpanded ? 'tag-row--expanded' : ''].filter(Boolean).join(' ')}>
          {hasChildren ? (
            <button
              type="button"
              className="tag-expander"
              aria-label={`${isExpanded ? '收起' : '展开'} ${tag.name}`}
              aria-expanded={isExpanded}
              onClick={() => onToggle(tag.id)}
            >
              <span className="tag-expander__hash" aria-hidden="true">#</span>
              <span className="tag-expander__triangle tag-expander__triangle--right" aria-hidden="true">▶</span>
              <span className="tag-expander__triangle tag-expander__triangle--down" aria-hidden="true">▼</span>
            </button>
          ) : (
            <span className="tag-prefix" aria-hidden="true">#</span>
          )}
          <button
            type="button"
            className="tag-button"
            onClick={() => onSelect(tag.id)}
            aria-pressed={selectedTagId === tag.id}
            aria-label={`${tag.name} (${tag.noteCount})`}
          >
            <span>{tag.name}</span>
            <span className="tag-count">{tag.noteCount}</span>
          </button>
        </div>
        {hasChildren && isExpanded ? <ul className="tag-list">{childItems}</ul> : null}
      </li>
    ];
  });
}

export function TagTree({ tags, selectedTagId, onSelect }: TagTreeProps) {
  const [expandedTagIds, setExpandedTagIds] = useState<Set<string>>(() => new Set());

  const toggleTag = (tagId: string) => {
    setExpandedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  };

  const items = renderTagItems({ tags, parentId: undefined, selectedTagId, expandedTagIds, onSelect, onToggle: toggleTag });

  return <nav className="tag-tree" aria-label="全部标签">{items.length > 0 ? <ul className="tag-list">{items}</ul> : null}</nav>;
}
