interface ColoredPasswordProps {
  value: string;
  revealed?: boolean;
  className?: string;
}

export function getCharColorVar(ch: string): string {
  if (/[0-9]/.test(ch)) return 'var(--pw-digit)';
  if (/[a-zA-Z]/.test(ch)) return 'var(--pw-letter)';
  if (/\s/.test(ch)) return 'var(--text-muted)';
  return 'var(--pw-symbol)';
}

export function ColoredPassword({ value, revealed = true, className = '' }: ColoredPasswordProps) {
  if (!revealed) {
    const dotCount = Math.min(18, Math.max(8, value.length || 12));
    return (
      <span className={`font-mono-tabular tracking-[0.18em] text-[var(--text-secondary)] ${className}`}>
        {'•'.repeat(dotCount)}
      </span>
    );
  }

  return (
    <span className={`font-mono-tabular break-all ${className}`} data-selectable="true">
      {Array.from(value).map((ch, idx) => (
        <span key={idx} style={{ color: getCharColorVar(ch) }}>
          {ch}
        </span>
      ))}
    </span>
  );
}
