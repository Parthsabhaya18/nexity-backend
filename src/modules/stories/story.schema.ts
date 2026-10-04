import { z } from 'zod';

const n01 = z.number().min(0).max(1);
const text = z.string().trim().min(1).max(80);

const base = {
  id: z.string().trim().min(4).max(40),
  x: n01,
  y: n01,
  scale: z.number().min(0.4).max(3).default(1),
  rotation: z.number().min(-180).max(180).default(0),
};

export const storyOverlaySchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('text'),
    text,
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().default(null),
  }),
  z.object({
    ...base,
    type: z.literal('sticker'),
    emoji: z.string().trim().min(1).max(8),
  }),
  z.object({
    ...base,
    type: z.literal('draw'),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    points: z.array(n01).min(4).max(160),
  }),
  z.object({
    ...base,
    type: z.literal('poll'),
    question: text,
    options: z.array(text).min(2).max(4),
  }),
  z.object({
    ...base,
    type: z.literal('question'),
    prompt: text,
  }),
  z.object({
    ...base,
    type: z.literal('quiz'),
    question: text,
    options: z.array(text).min(2).max(4),
    answer: z.number().int().min(0).max(3),
  }),
  z.object({
    ...base,
    type: z.literal('countdown'),
    title: text,
    ends_at: z.iso.datetime(),
  }),
  z.object({
    ...base,
    type: z.literal('link'),
    label: text,
    url: z.string().trim().url().max(200),
  }),
  z.object({
    ...base,
    type: z.literal('hashtag'),
    tag: z.string().trim().min(1).max(30).regex(/^[\p{L}\p{N}_]+$/u),
  }),
  z.object({
    ...base,
    type: z.literal('mention'),
    username: z.string().trim().min(3).max(30),
  }),
]);

export const storyOverlaysSchema = z.array(storyOverlaySchema).max(12).default([]);

export type StoryOverlay = z.infer<typeof storyOverlaySchema>;
