/** Instagram's limits. */
export const CAPTION_MAX = 2200;
export const MAX_MENTIONS = 20;
/** People that can be tagged on a single post. */
export const MAX_TAGGED = 20;

/**
 * Same characters as usernames; a trailing dot ends the sentence, not the name.
 * Only at the start, after a space or an opening bracket, so "…@ann" or "hi@ann" is not a mention.
 */
const MENTION_RE = /(^|[\s([{])@([a-z0-9._]{1,30})/gi;

const unique = (values: string[]) => [...new Set(values)];

export function extractMentions(caption: string) {
  return unique(
    [...caption.matchAll(MENTION_RE)].map((m) => m[2]!.toLowerCase().replace(/\.+$/, '')),
  ).filter((name) => name.length >= 3);
}
