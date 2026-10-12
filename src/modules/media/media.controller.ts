import type { RequestHandler } from 'express';

import { createUploadSchema, mediaIdSchema, partUrlsSchema } from './media.schema';
import * as media from './media.service';

export const createUpload: RequestHandler = async (req, res) => {
  res.status(201).json(await media.createUpload(req.user!, createUploadSchema.parse(req.body)));
};

export const presignParts: RequestHandler = async (req, res) => {
  const { id } = mediaIdSchema.parse(req.params);
  const { part_numbers } = partUrlsSchema.parse(req.body);
  res.json(await media.presignParts(req.user!, id, part_numbers));
};

export const listParts: RequestHandler = async (req, res) => {
  const { id } = mediaIdSchema.parse(req.params);
  res.json(await media.listUploadedParts(req.user!, id));
};

export const completeUpload: RequestHandler = async (req, res) => {
  const { id } = mediaIdSchema.parse(req.params);
  res.json(await media.completeUpload(req.user!, id));
};

export const getMedia: RequestHandler = async (req, res) => {
  const { id } = mediaIdSchema.parse(req.params);
  res.json(await media.getMedia(req.user!, id));
};

export const deleteMedia: RequestHandler = async (req, res) => {
  const { id } = mediaIdSchema.parse(req.params);
  await media.deleteMedia(req.user!, id);
  res.status(204).end();
};
