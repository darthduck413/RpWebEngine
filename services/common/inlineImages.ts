// Markdown image syntax embedded in message text: ![alt](url).
//
// These are decorative "story images" (e.g. the Melody card appends one at the
// end of each greeting). They are shown in the chat UI only and must NEVER reach
// the model — not as an actual image, and not as a raw URL leaking through the
// text. Attachments/avatars are governed separately by the `ignoreImages`
// setting; inline story images are always display-only.
export const INLINE_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

// Remove inline image markdown from text destined for the model. When an image
// is removed, collapse the blank line it used to occupy so we don't leave a
// ragged gap. If the text contains no inline image, it is returned completely
// untouched — this guarantees that ordinary messages reach the model byte-for-
// byte as before (no whitespace normalization, no unexpected divergence from
// what the user sees).
export const stripInlineImages = (text: string | null | undefined): string => {
  const source = text ?? '';
  const stripped = source.replace(INLINE_IMAGE_RE, '');
  if (stripped === source) return source;
  return stripped
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
