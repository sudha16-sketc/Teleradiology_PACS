/**
 * Client-side rich HTML sanitizer. Mirrors the server-side defense in depth so
 * stored markup can never execute scripts or load arbitrary remote resources.
 */
export function sanitizeReportHtml(html: string): string {
  return html
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      '',
    )
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/(src|href)\s*=\s*("|')\s*data:[^"']*\2/gi, '$1=""');
}

export function htmlToPlainText(html?: string | null): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|table|blockquote|figure)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert the legacy structured report fields into rich HTML so existing drafts
 * and templates open in the new editor without losing any content.
 */
export function legacyFieldsToHtml(fields: {
  clinicalHistory?: string;
  technique?: string;
  comparison?: string;
  findings?: string;
  impression?: string;
  recommendations?: string;
}): string {
  const section = (title: string, value?: string) =>
    value && value.trim()
      ? `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(value).replace(/\n/g, '<br />')}</p>`
      : '';
  return [
    section('Clinical History', fields.clinicalHistory),
    section('Technique', fields.technique),
    section('Comparison', fields.comparison),
    section('Findings', fields.findings),
    section('Impression', fields.impression),
    section('Recommendations', fields.recommendations),
  ]
    .filter(Boolean)
    .join('');
}
