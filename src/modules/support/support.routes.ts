import { Router } from 'express';

import { supportLimiter } from '../../middlewares/rateLimit';
import { requireAuth } from '../../middlewares/requireAuth';
import { deviceOf } from '../auth/auth.controller';
import { createTicketSchema, ticketIdParamsSchema } from './support.schema';
import { createTicket, myTicket, myTickets } from './support.service';

export const supportRouter = Router();

supportRouter.use(requireAuth);

supportRouter.get('/tickets', async (req, res) => {
  res.json(await myTickets(req.user!));
});

supportRouter.get('/tickets/:id', async (req, res) => {
  const { id } = ticketIdParamsSchema.parse(req.params);
  res.json(await myTicket(req.user!, id));
});

supportRouter.post('/tickets', supportLimiter, async (req, res) => {
  res
    .status(201)
    .json(await createTicket(req.user!, createTicketSchema.parse(req.body), deviceOf(req)));
});
