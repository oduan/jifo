import { useCallback, useEffect, useState } from 'react';

export type WorkspaceView = {
  query: string;
  tagId: string | null;
  tagPath?: string;
  showTrash: boolean;
};

const EMPTY_VIEW: WorkspaceView = { query: '', tagId: null, tagPath: undefined, showTrash: false };

function readView(): WorkspaceView {
  if (typeof window === 'undefined') {
    return EMPTY_VIEW;
  }
  const params = new URLSearchParams(window.location.search);
  const showTrash = params.get('view') === 'trash';
  const tagId = params.get('tag');
  return {
    query: params.get('q') ?? '',
    tagId: showTrash ? null : tagId,
    tagPath: showTrash ? undefined : params.get('tagPath') ?? tagId ?? undefined,
    showTrash
  };
}

function toSearch(view: WorkspaceView): string {
  const params = new URLSearchParams();
  if (view.query.trim()) {
    params.set('q', view.query.trim());
  }
  if (view.showTrash) {
    params.set('view', 'trash');
  } else if (view.tagId) {
    params.set('tag', view.tagId);
    if (view.tagPath && view.tagPath !== view.tagId) {
      params.set('tagPath', view.tagPath);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : window.location.pathname;
}

export function useWorkspaceView() {
  const [view, setView] = useState<WorkspaceView>(readView);

  useEffect(() => {
    const onPopState = () => setView(readView());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const commit = useCallback((next: WorkspaceView) => {
    setView(next);
    const target = toSearch(next);
    if (target !== `${window.location.pathname}${window.location.search}` && target !== window.location.search) {
      window.history.pushState(null, '', target);
    }
  }, []);

  const setQuery = useCallback(
    (query: string) => setView((current) => {
      const next = { ...current, query };
      const target = toSearch(next);
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (target !== currentUrl) {
        window.history.replaceState(null, '', target);
      }
      return next;
    }),
    []
  );

  const selectTag = useCallback((tagId: string | null, tagPath?: string) => commit({ ...EMPTY_VIEW, query: view.query, tagId, tagPath }), [commit, view.query]);
  const selectTrash = useCallback(() => commit({ ...EMPTY_VIEW, query: view.query, showTrash: true }), [commit, view.query]);
  const reset = useCallback(() => {
    setView(EMPTY_VIEW);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return { view, setQuery, selectTag, selectTrash, reset };
}
