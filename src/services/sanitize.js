import DOMPurify from 'dompurify';

// Every mark the editor can produce must be listed here: a tag stripped on
// save comes back as a "remote" change, the editor re-adds it and saves
// again, forever (underline, <u>, was missing and did exactly that).
const ALLOWED_TAGS = ['p','strong','em','u','s','code','pre','blockquote','ul','ol','li','h1','h2','h3','br','a','hr','mark','span'];
const ALLOWED_ATTR = ['href','target','rel','data-comment-id','data-type','data-id','class','style','data-ref-type','data-db-name','data-entry-id-ref'];

export function sanitizeHtml(dirty) {
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS, ALLOWED_ATTR });
}
