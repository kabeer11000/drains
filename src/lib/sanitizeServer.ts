import sanitize from 'sanitize-html'
import { ALLOWED_TAGS, ALLOWED_ATTR } from './htmlPolicy'

// Server-side twin of services/sanitize.js, for HTML rendered with set:html
// on pages anyone can open (/p/<token>). Stored content can't be trusted to
// have passed the client's sanitizer: anyone with write access can put
// documents straight into CouchDB.
export function sanitizeEntryHtml(dirty: string): string {
  return sanitize(dirty, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { '*': ALLOWED_ATTR },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Inline styles only ever carry mention colours; anything else (position,
    // overlays, url()) is dropped.
    allowedStyles: {
      '*': {
        color: [/^[#a-z0-9(),.%\s-]+$/i],
        'background-color': [/^[#a-z0-9(),.%\s-]+$/i],
        background: [/^[#a-z0-9(),.%\s-]+$/i],
      },
    },
    transformTags: {
      a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
    },
  })
}
