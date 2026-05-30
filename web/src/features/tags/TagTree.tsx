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

function renderTags(tags: TagNode[], parentId: string | undefined, onSelect: (tagId: string) => void, selectedTagId?: string | null) {
  const children = tags.filter((tag) => tag.parentId === parentId && hasVisibleSelfOrDescendant(tags, tag));
  if (children.length === 0) {
    return null;
  }

  return (
    <ul className="tag-list">
      {children.map((tag) => {
        const childTree = renderTags(tags, tag.id, onSelect, selectedTagId);
        if (tag.noteCount === 0) {
          return <li key={tag.id}>{childTree}</li>;
        }
        return (
          <li key={tag.id}>
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
            {childTree}
          </li>
        );
      })}
    </ul>
  );
}

export function TagTree({ tags, selectedTagId, onSelect }: TagTreeProps) {
  return <nav className="tag-tree" aria-label="全部标签">{renderTags(tags, undefined, onSelect, selectedTagId)}</nav>;
}
