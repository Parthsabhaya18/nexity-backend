/** Colour looks shared by posts, stories and reels. `normal` leaves the media unchanged. */
export const MEDIA_LOOKS = [
  'normal',
  'clarendon',
  'juno',
  'lark',
  'valencia',
  'ocean',
  'fade',
  'moon',
] as const;

export type MediaLook = (typeof MEDIA_LOOKS)[number];
