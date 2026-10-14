// The one HTML allowlist for entry content, shared by the editor's
// DOMPurify pass (services/sanitize.js) and the server's sanitize-html pass
// (lib/sanitizeServer.ts) so the two can never drift.
//
// Every mark/node the editor can produce must be listed: a tag stripped on
// save comes back as a "remote" change, the editor re-adds it and saves
// again, forever (underline, <u>, was missing and did exactly that).
export const ALLOWED_TAGS = [
  'p', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'br', 'a', 'hr', 'mark', 'span',
]

export const ALLOWED_ATTR = [
  'href', 'target', 'rel', 'class', 'style',
  'data-comment-id', 'data-type', 'data-id',
  'data-ref-type', 'data-db-name', 'data-entry-id-ref',
  // Embeds (Feed/EmbedExtension): a kind and the original URL, never an iframe.
  'data-embed', 'data-url',
]
