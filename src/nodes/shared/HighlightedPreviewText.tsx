import type { ReactNode } from 'react';
import type { FormattedChatHistorySegment } from '../../workflow';
import { coloredDialogueParts, dialogueColors } from '../../chat/textRendering';

type ChatHistoryHighlightMode = 'none' | 'auto';

type HighlightedPreviewTextProps = {
  text: string;
  className?: string;
  chatHistory?: ChatHistoryHighlightMode;
  historySegments?: FormattedChatHistorySegment[];
};

const previewJsonTokenPattern =
  /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]/g;

function previewTokenClass(match: string, stringMatch?: string, keySuffix?: string) {
  if (stringMatch) return keySuffix ? 'json-token-key' : 'json-token-string';
  if (match === 'true' || match === 'false') return 'json-token-boolean';
  if (match === 'null') return 'json-token-null';
  if (/^-?\d/.test(match)) return 'json-token-number';
  return 'json-token-punctuation';
}

function highlightedPreviewText(text: string) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  text.replace(previewJsonTokenPattern, (match, stringMatch: string | undefined, keySuffix: string | undefined, offset: number) => {
    if (offset > lastIndex) nodes.push(text.slice(lastIndex, offset));
    nodes.push(<span className={previewTokenClass(match, stringMatch, keySuffix)} key={`${offset}-${match}`}>{stringMatch ?? match}</span>);
    if (keySuffix) nodes.push(keySuffix);
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function speakerColor(
  name: string,
  names: string[],
  colors: Record<string, string> | undefined,
) {
  const index = names.indexOf(name);
  const fallbackIndex = index >= 0
    ? index
    : Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return colors?.[name] ?? dialogueColors[fallbackIndex % dialogueColors.length];
}

function isNameBoundary(text: string, index: number) {
  if (index < 0 || index >= text.length) {
    return true;
  }
  return !/[\p{L}\p{N}_]/u.test(text[index]);
}

function nameRanges(text: string, names: string[]) {
  return [...names]
    .sort((left, right) => right.length - left.length)
    .flatMap((name) => {
      if (!name.trim()) {
        return [];
      }
      const ranges: Array<{ start: number; end: number; name: string }> = [];
      const pattern = new RegExp(escapeRegExp(name), 'gi');
      text.replace(pattern, (match, offset: number) => {
        const start = offset;
        const end = offset + match.length;
        if (isNameBoundary(text, start - 1) && isNameBoundary(text, end)) {
          ranges.push({ start, end, name });
        }
        return match;
      });
      return ranges;
    })
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((range, index, ranges) => index === 0 || range.start >= ranges[index - 1].end);
}

function inferredSpeakerNames(text: string) {
  const names = new Set<string>();
  const add = (value: string | undefined) => {
    const name = value?.trim();
    if (name && name.length <= 80) {
      names.add(name);
    }
  };
  text.replace(/\[[^\]\n]+\]\s*([^:\n]+?)\s+texts\s+([^:\n]+?):/gi, (_match, from: string, to: string) => {
    add(from);
    add(to);
    return _match;
  });
  text.replace(/(^|\n)([^:\n]+?)\s+texts\s+([^:\n]+?):/gi, (_match, _prefix: string, from: string, to: string) => {
    add(from);
    add(to);
    return _match;
  });
  text.replace(/(^|\n)Character:\s*([^\n]+)/gi, (_match, _prefix: string, name: string) => {
    add(name);
    return _match;
  });
  return Array.from(names);
}

function renderNameAndJsonText(
  text: string,
  names: string[] = [],
  colors?: Record<string, string>,
  keyPrefix = 'text',
  highlightJson = true,
) {
  const ranges = nameRanges(text, names);
  const renderText = highlightJson ? highlightedPreviewText : (value: string) => [value];
  if (!ranges.length) {
    return renderText(text);
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(...renderText(text.slice(cursor, range.start)));
    }
    nodes.push(
      <span
        className="highlighted-preview-name"
        key={`${keyPrefix}-name-${index}-${range.start}`}
        style={{ color: speakerColor(range.name, names, colors) }}
      >
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    nodes.push(...renderText(text.slice(cursor)));
  }
  return nodes;
}

function renderSegmentText(segment: FormattedChatHistorySegment) {
  const names = segment.speakerNames ?? [];
  if (segment.dialogue?.length) {
    return coloredDialogueParts(segment.text, segment.dialogue).map((part, index) => {
      if ('speakerName' in part && part.speakerName) {
        const color = speakerColor(part.speakerName, names, segment.speakerColors);
        return (
          <span
            className="dialogue-highlight highlighted-preview-dialogue"
            key={`dialogue-${index}`}
            style={{ color }}
          >
            {renderNameAndJsonText(part.text, names, segment.speakerColors, `dialogue-${index}`, false)}
          </span>
        );
      }
      return renderNameAndJsonText(part.text, names, segment.speakerColors, `segment-${index}`, false);
    });
  }
  return renderNameAndJsonText(segment.text, names, segment.speakerColors, 'segment', false);
}

function likelyChatHistoryText(text: string) {
  return (
    /\[[^\]\n]*(?:\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})[^\]\n]*\]\s+\S/.test(text) ||
    /\b(?:texts|sends? an image|sends? images|replied to)\b[^:\n]*:/i.test(text)
  );
}

function isPhoneHistoryParagraph(text: string) {
  return /\b(?:texts|sends? an image|sends? images|replied to)\b[^:\n]*:/i.test(text);
}

function automaticHistoryParts(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const parts: Array<{ text: string; channel: 'rp' | 'phone' }> = [];
  let pendingRp: string[] = [];
  const flushRp = () => {
    if (!pendingRp.length) {
      return;
    }
    parts.push({ text: pendingRp.join('\n\n'), channel: 'rp' });
    pendingRp = [];
  };
  paragraphs.forEach((paragraph) => {
    if (isPhoneHistoryParagraph(paragraph)) {
      flushRp();
      parts.push({ text: paragraph, channel: 'phone' });
      return;
    }
    pendingRp.push(paragraph);
  });
  flushRp();
  return parts;
}

function automaticHistorySegments(text: string, mode: ChatHistoryHighlightMode): FormattedChatHistorySegment[] | undefined {
  if (mode === 'none' || (mode === 'auto' && !likelyChatHistoryText(text))) {
    return undefined;
  }
  const parts = automaticHistoryParts(text);
  if (!parts.length) {
    return undefined;
  }
  return parts.map((part, index) => ({
    text: part.text,
    turnKey: `preview:${index}`,
    turnIndex: index,
    messageIndex: index,
    role: index % 2 === 0 ? 'user' : 'output',
    channel: part.channel,
    speakerNames: inferredSpeakerNames(part.text),
  }));
}

function segmentClassName(segment: FormattedChatHistorySegment) {
  return [
    'highlighted-preview-history-block',
    segment.turnIndex % 2 === 0 ? 'turn-even' : 'turn-odd',
    segment.messageIndex % 2 === 0 ? 'message-even' : 'message-odd',
    `role-${segment.role}`,
    `channel-${segment.channel}`,
  ].join(' ');
}

export function HighlightedPreviewText({
  text,
  className = '',
  chatHistory = 'none',
  historySegments,
}: HighlightedPreviewTextProps) {
  const segments = historySegments?.length
    ? historySegments
    : automaticHistorySegments(text, chatHistory);
  if (segments?.length) {
    return (
      <div className={['highlighted-preview-text highlighted-preview-history', className].filter(Boolean).join(' ')}>
        {segments.map((segment) => (
          <pre className={segmentClassName(segment)} key={`${segment.turnKey}-${segment.messageIndex}`}>
            {renderSegmentText(segment)}
          </pre>
        ))}
      </div>
    );
  }
  return (
    <pre className={['highlighted-preview-text', className].filter(Boolean).join(' ')}>
      {renderNameAndJsonText(text)}
    </pre>
  );
}
