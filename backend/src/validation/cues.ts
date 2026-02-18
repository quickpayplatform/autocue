import { z } from "zod";
export const cueChannelSchema = z.object({
  channelNumber: z.number().int().positive(),
  level: z.number().int().min(0).max(100)
});

export const cueCreateSchema = z.object({
  venueId: z.string().uuid(),
  cueNumber: z.number().int().positive(),
  cueList: z.number().int().positive().default(1),
  fadeTime: z.number().min(0),
  notes: z.string().optional().default(""),
  channels: z.array(cueChannelSchema).min(1)
});

export const cueUpdateSchema = z.object({
  cueNumber: z.number().int().positive().optional(),
  cueList: z.number().int().positive().optional(),
  fadeTime: z.number().min(0).optional(),
  notes: z.string().optional(),
  channels: z.array(cueChannelSchema).min(1).optional()
});

export const cueApprovalSchema = z.object({
  confirmDuplicate: z.boolean().optional().default(false),
  label: z.string().optional()
});
