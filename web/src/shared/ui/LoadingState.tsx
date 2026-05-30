type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = '加载中…' }: LoadingStateProps) {
  return (
    <section className="loading-state" aria-live="polite">
      {label}
    </section>
  );
}
