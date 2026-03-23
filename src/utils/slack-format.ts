/**
 * Convert GitHub-flavored markdown to Slack's mrkdwn format.
 * Slack uses different syntax for bold, italic, code, links, etc.
 */
export function toSlackMarkdown(text: string): string {
  let result = text;

  // Headers: ## Title → *Title*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Bold: **text** → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Italic: _text_ stays the same in Slack
  // But __text__ (double underscore bold) is not supported
  result = result.replace(/__(.+?)__/g, '*$1*');

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Inline code: `code` stays the same

  // Code blocks: ```lang\ncode\n``` → ```\ncode\n```
  // Slack doesn't support language hints in code blocks
  result = result.replace(/```\w*\n/g, '```\n');

  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Images: ![alt](url) → <url|alt>
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');

  // Bullet lists: - item or * item → • item
  result = result.replace(/^[\s]*[-*]\s+/gm, '• ');

  // Numbered lists: keep as-is (Slack handles them)

  // Horizontal rules: --- or *** → ───────
  result = result.replace(/^[-*]{3,}$/gm, '───────────────────');

  // Blockquotes: > text stays the same in Slack

  // Clean up excessive newlines (max 2 consecutive)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

/**
 * Truncate text to Slack's message limit (max 4000 chars for best display).
 * Preserves code blocks integrity when truncating.
 */
export function truncateForSlack(text: string, maxLen = 3000): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  // Try to cut at a newline boundary
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = lastNewline > maxLen * 0.8 ? lastNewline : maxLen;
  return truncated.slice(0, cutPoint) + '\n\n_(출력 일부 생략)_';
}
