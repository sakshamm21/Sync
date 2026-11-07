import React from 'react';
import Link from 'next/link';

/**
 * Renders the small Markdown subset the assistant is asked to use: paragraphs,
 * bulleted / numbered lists, **bold**, `code` and [links](/events/id).
 * Everything goes through React elements (never innerHTML), so model output
 * can't inject markup.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, onNavigate?: () => void): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      const className = 'font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary';
      if (href.startsWith('/') && !href.startsWith('//')) {
        return (
          <Link key={i} href={href} onClick={onNavigate} className={className}>
            {label}
          </Link>
        );
      }
      if (/^https?:\/\//i.test(href)) {
        return (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" className={className}>
            {label}
          </a>
        );
      }
      return label;
    }
    return part;
  });
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

function toBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);

    if (!line) {
      blocks.push({ kind: 'p', lines: [] });
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const item = (bullet ?? numbered)![1];
      if (last?.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (last?.kind === 'p') {
      last.lines.push(line.replace(/^#+\s*/, ''));
    } else {
      blocks.push({ kind: 'p', lines: [line.replace(/^#+\s*/, '')] });
    }
  }
  return blocks.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : b.items.length > 0));
}

export default function Markdown({ children, onNavigate }: { children: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-2.5">
      {toBlocks(children).map((block, i) => {
        if (block.kind === 'p') {
          return (
            <p key={i}>
              {block.lines.map((line, j) => (
                <React.Fragment key={j}>
                  {j > 0 && <br />}
                  {renderInline(line, onNavigate)}
                </React.Fragment>
              ))}
            </p>
          );
        }
        const List = block.kind;
        return (
          <List
            key={i}
            className={
              List === 'ul' ? 'list-disc space-y-1 pl-5 marker:text-primary' : 'list-decimal space-y-1 pl-5 marker:text-muted'
            }
          >
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item, onNavigate)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
