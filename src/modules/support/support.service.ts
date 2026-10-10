import type { z } from 'zod';

import { ApiError } from '../../utils/ApiError';
import type { DeviceInfo } from '../auth/tokens';
import { Media } from '../media/media.model';
import { viewUrl } from '../media/media.storage';
import type { UserDoc } from '../users/user.model';
import type { createTicketSchema } from './support.schema';
import { SupportTicket, type SupportTicketDoc } from './supportTicket.model';

const LIST_LIMIT = 50;

/** Short reference shown to the user and quoted to support, e.g. `NX-3F9A2C`. */
const referenceOf = (ticket: SupportTicketDoc) =>
  `NX-${(ticket.id as string).slice(-6).toUpperCase()}`;

async function toTicketDto(ticket: SupportTicketDoc) {
  return {
    id: ticket.id as string,
    reference: referenceOf(ticket),
    subject: ticket.subject,
    message: ticket.message,
    status: ticket.status,
    screenshot_urls: await Promise.all(ticket.screenshots.map((s) => viewUrl(s.key))),
    created_at: (ticket.get('created_at') as Date).toISOString(),
    updated_at: (ticket.get('updated_at') as Date).toISOString(),
  };
}

export async function createTicket(
  user: UserDoc,
  input: z.infer<typeof createTicketSchema>,
  device: DeviceInfo,
) {
  const ids = input.screenshot_media_ids;
  const found = ids.length
    ? await Media.find({ _id: { $in: ids }, owner_id: user._id })
    : [];
  const byId = new Map(found.map((m) => [m.id as string, m]));
  const screenshots = ids.map((id) => {
    const media = byId.get(id);
    if (
      !media ||
      media.status !== 'ready' ||
      media.kind !== 'image' ||
      media.purpose !== 'support'
    ) {
      throw ApiError.badRequest(
        "We couldn't attach a screenshot. Please upload it again.",
        { field: 'screenshot_media_ids', media_id: id },
        'INVALID_SCREENSHOT',
      );
    }
    return { media_id: media._id, key: media.key };
  });
  const ticket = await SupportTicket.create({
    user_id: user._id,
    subject: input.subject,
    message: input.message,
    screenshots,
    platform: device.platform ?? null,
    app_version: device.appVersion ?? null,
  });
  return toTicketDto(ticket);
}

export async function myTicket(user: UserDoc, id: string) {
  const ticket = await SupportTicket.findOne({ _id: id, user_id: user._id });
  if (!ticket) throw ApiError.notFound('Request not found');
  return toTicketDto(ticket);
}

export async function myTickets(user: UserDoc) {
  const rows = await SupportTicket.find({ user_id: user._id }).sort({ _id: -1 }).limit(LIST_LIMIT);
  return { items: await Promise.all(rows.map(toTicketDto)) };
}
