/** Instagram's limits. */
export const CAPTION_MAX = 2200;
export const MAX_HASHTAGS = 30;
export const MAX_MENTIONS = 20;
export const HASHTAG_MAX_LENGTH = 100;

/** Letters (any script, with vowel signs), digits and underscores, like Instagram. */
const HASHTAG_RE = /(^|[^\p{L}\p{M}\p{N}_&])#([\p{L}\p{M}\p{N}_]{1,100})/gu;
/** Same characters as usernames; a trailing dot ends the sentence, not the name. */
const MENTION_RE = /(^|[^\w.@])@([a-z0-9._]{1,30})/gi;

const unique = (values: string[]) => [...new Set(values)];

export function extractHashtags(caption: string) {
  return unique(
    [...caption.matchAll(HASHTAG_RE)]
      .map((m) => m[2]!.toLowerCase())
      .filter((tag) => !/^\d+$/.test(tag)),
  );
}

export function extractMentions(caption: string) {
  return unique(
    [...caption.matchAll(MENTION_RE)].map((m) => m[2]!.toLowerCase().replace(/\.+$/, '')),
  ).filter((name) => name.length >= 3);
}
