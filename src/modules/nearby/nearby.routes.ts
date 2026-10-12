import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import { nearbyLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { issueTokens, listNearbyUsers, reportSightings } from './nearby.ble';
import { ingestLocation, settingsDto, updateSettings } from './nearby.service';

const settingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    location_enabled: z.boolean().optional(),
    notifications_enabled: z.boolean().optional(),
    bluetooth_enabled: z.boolean().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const locationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(100_000),
    captured_at: z.coerce.date(),
  })
  .strict();

const getSettings: RequestHandler = (req, res) => {
  res.json(settingsDto(req.user!));
};

const patchSettings: RequestHandler = async (req, res) => {
  res.json(await updateSettings(req.user!, settingsPatchSchema.parse(req.body)));
};

const postLocation: RequestHandler = async (req, res) => {
  res.status(202).json(await ingestLocation(req.user!, locationSchema.parse(req.body)));
};

const sightingSchema = z
  .object({
    sightings: z
      .array(
        z
          .object({
            eph_id: z.string().trim().min(16).max(64),
            first_seen_at: z.coerce.date(),
            last_seen_at: z.coerce.date(),
            count: z.number().int().min(1).max(10_000),
            rssi_max: z.number().min(-120).max(20),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

const postTokens: RequestHandler = async (req, res) => {
  res.json(await issueTokens(req.user!));
};

const postSightings: RequestHandler = async (req, res) => {
  res.status(202).json(await reportSightings(req.user!, sightingSchema.parse(req.body).sightings));
};

const getUsers: RequestHandler = async (req, res) => {
  res.json(await listNearbyUsers(req.user!));
};

export const nearbyRouter = Router();
nearbyRouter.use(requireAuth, nearbyLimiter);
nearbyRouter.get('/settings', getSettings);
nearbyRouter.patch('/settings', patchSettings);
nearbyRouter.post('/location', postLocation);
nearbyRouter.post('/ble/tokens', postTokens);
nearbyRouter.post('/ble/sightings', postSightings);
nearbyRouter.get('/users', getUsers);
