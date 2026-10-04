export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Username or display name containing `q`, so "smith" finds "bob.smith". */
export function userSearchFilter(raw: string) {
  const q = escapeRegex(raw.trim().replace(/^@/, ''));
  return {
    $or: [
      { username: new RegExp(q.toLowerCase()) },
      { display_name: new RegExp(q, 'i') },
    ],
  };
}
