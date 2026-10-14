import DOMPurify from 'dompurify';
import { ALLOWED_TAGS, ALLOWED_ATTR } from '../lib/htmlPolicy';


export function sanitizeHtml(dirty) {
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS, ALLOWED_ATTR });
}
