export type TagNode = {
  id: string;
  name: string;
  noteCount: number;
  parentId?: string;
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
    <ul style={{ listStyle: 'none', paddingLeft: parentId ? 16 : 0, margin: 0 }}>
      {children.map((tag) => {
        const childTree = renderTags(tags, tag.id, onSelect, selectedTagId);
        if (tag.noteCount === 0) {
          return <li key={tag.id}>{childTree}</li>;
        }
        return (
          <li key={tag.id}>
            <button
              type="button"
              onClick={() => onSelect(tag.id)}
              aria-pressed={selectedTagId === tag.id}
              style={{
                border: 0,
                background: selectedTagId === tag.id ? '#dcfce7' : 'transparent',
                borderRadius: 8,
                padding: '4px 8px',
                cursor: 'pointer'
              }}
            >
              {tag.name} ({tag.noteCount})
            </button>
            {childTree}
          </li>
        );
      })}
    </ul>
  );
}

export function TagTree({ tags, selectedTagId, onSelect }: TagTreeProps) {
  return <nav aria-label="全部标签">{renderTags(tags, undefined, onSelect, selectedTagId)}</nav>;
}
