// Output truncation by lines AND bytes — whichever limit is hit first.
// Ported from the pi agent harness (packages/agent/src/harness/utils/truncate.ts).
// truncateHead keeps the start (good for file reads); truncateTail keeps the
// end (good for command/test output, where errors live at the bottom).

export interface TruncateOptions {
  maxLines?: number;
  maxBytes?: number;
}

export interface TruncateResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  totalBytes: number;
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** Keep the FIRST maxLines / maxBytes of content. */
export function truncateHead(content: string, options: TruncateOptions = {}): TruncateResult {
  const { maxLines = Number.POSITIVE_INFINITY, maxBytes = Number.POSITIVE_INFINITY } = options;
  const lines = content.split("\n");
  const totalLines = lines.length;
  const totalBytes = byteLength(content);

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false, totalLines, totalBytes };
  }

  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (kept.length >= maxLines) break;
    const lineBytes = byteLength(line) + 1;
    if (bytes + lineBytes > maxBytes && kept.length > 0) break;
    kept.push(line);
    bytes += lineBytes;
  }
  const omitted = totalLines - kept.length;
  return {
    content: `${kept.join("\n")}\n... [truncated ${omitted} more line(s); ${totalBytes} bytes total]`,
    truncated: true,
    totalLines,
    totalBytes,
  };
}

/** Keep the LAST maxLines / maxBytes of content. */
export function truncateTail(content: string, options: TruncateOptions = {}): TruncateResult {
  const { maxLines = Number.POSITIVE_INFINITY, maxBytes = Number.POSITIVE_INFINITY } = options;
  const lines = content.split("\n");
  const totalLines = lines.length;
  const totalBytes = byteLength(content);

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false, totalLines, totalBytes };
  }

  const kept: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (kept.length >= maxLines) break;
    const lineBytes = byteLength(line) + 1;
    if (bytes + lineBytes > maxBytes && kept.length > 0) break;
    kept.push(line);
    bytes += lineBytes;
  }
  kept.reverse();
  const omitted = totalLines - kept.length;
  return {
    content: `... [truncated ${omitted} earlier line(s); ${totalBytes} bytes total]\n${kept.join("\n")}`,
    truncated: true,
    totalLines,
    totalBytes,
  };
}
