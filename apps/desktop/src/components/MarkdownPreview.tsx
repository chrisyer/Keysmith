import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { tauriClient } from '../services/tauriClient';
import { openExternalUrl } from '../utils/opener';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

type BlockNode =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'ul'; items: Array<{ text: string; checked?: boolean }> }
  | { kind: 'ol'; items: string[] }
  | { kind: 'hr' }
  | { kind: 'paragraph'; text: string };

function parseMarkdownBlocks(raw: string): BlockNode[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    const fenceMatch = /^```([\w+-]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(4, headingMatch[1].length) as 1 | 2 | 3 | 4;
      blocks.push({ kind: 'heading', level, text: headingMatch[2] });
      i += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', lines: quoteLines });
      continue;
    }

    // Unordered / task list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: Array<{ text: string; checked?: boolean }> = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        const itemBody = lines[i].trim().replace(/^[-*+]\s+/, '');
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(itemBody);
        if (taskMatch) {
          items.push({
            checked: taskMatch[1].toLowerCase() === 'x',
            text: taskMatch[2],
          });
        } else {
          items.push({ text: itemBody });
        }
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Paragraph (join consecutive plain lines)
    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(```|#{1,4}\s+|>|[-*+]\s+|\d+\.\s+|-{3,}|\*{3,}|_{3,})/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: paraLines.join('\n') });
  }

  return blocks;
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function renderInlineNodes(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    keyIdx += 1;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={keyIdx}
          className="px-1.5 py-0.5 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)] font-mono-tabular text-[12px] text-[var(--accent-primary)]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={keyIdx} className="font-semibold text-[var(--text-primary)]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={keyIdx} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch && isSafeHttpUrl(linkMatch[2].trim())) {
        const href = linkMatch[2].trim();
        nodes.push(
          <button
            key={keyIdx}
            type="button"
            onClick={() => void openExternalUrl(href)}
            className="inline-flex items-center gap-0.5 text-[var(--accent-primary)] hover:underline cursor-pointer"
          >
            <span>{linkMatch[1]}</span>
            <ExternalLink size={11} />
          </button>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }

    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }

  return nodes;
}

function CodeFence({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] overflow-hidden">
      <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] flex items-center justify-between text-[10.5px] text-[var(--text-muted)]">
        <span className="font-mono-tabular uppercase">{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => {
            void tauriClient.clipboardCopySecret(code, lang || 'Code', false);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="inline-flex items-center gap-1 hover:text-[var(--accent-primary)] cursor-pointer"
        >
          {copied ? <Check size={11} className="text-[var(--status-success)]" /> : <Copy size={11} />}
          <span>{copied ? '✓' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto font-mono-tabular text-[12px] leading-relaxed text-[var(--text-primary)] whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

export function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={`space-y-2.5 text-[13px] leading-relaxed text-[var(--text-primary)] ${className}`}>
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case 'heading': {
            const sizeClass =
              block.level === 1
                ? 'text-[15px] font-bold mt-2'
                : block.level === 2
                  ? 'text-[14px] font-semibold mt-1.5'
                  : 'text-[13px] font-semibold mt-1';
            return (
              <div key={idx} className={`${sizeClass} text-[var(--text-primary)]`}>
                {renderInlineNodes(block.text)}
              </div>
            );
          }
          case 'code':
            return <CodeFence key={idx} lang={block.lang} code={block.code} />;
          case 'quote':
            return (
              <blockquote
                key={idx}
                className="pl-3 border-l-2 border-[var(--accent-primary)]/50 text-[var(--text-secondary)] space-y-1"
              >
                {block.lines.map((l, li) => (
                  <p key={li}>{renderInlineNodes(l)}</p>
                ))}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={idx} className="space-y-1 pl-1">
                {block.items.map((item, li) => (
                  <li key={li} className="flex items-start gap-2">
                    {typeof item.checked === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={item.checked}
                        readOnly
                        className="ks-checkbox mt-1 pointer-events-none"
                      />
                    ) : (
                      <span className="text-[var(--text-muted)] select-none">•</span>
                    )}
                    <span className={item.checked ? 'line-through text-[var(--text-muted)]' : ''}>
                      {renderInlineNodes(item.text)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx} className="list-decimal pl-5 space-y-1">
                {block.items.map((item, li) => (
                  <li key={li}>{renderInlineNodes(item)}</li>
                ))}
              </ol>
            );
          case 'hr':
            return <hr key={idx} className="border-[var(--border-subtle)] my-2" />;
          case 'paragraph':
            return (
              <p key={idx} className="whitespace-pre-wrap break-words">
                {renderInlineNodes(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
