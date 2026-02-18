import { z } from "zod";
import { config } from "../config.js";

export const cueChannelSchema = z.object({
  channelNumber: z.number().int().min(config.patchRange.min).max(config.patchRange.max),
  level: z.number().int().min(0).max(100)
});

export const cueCreateSchema = z.object({
  cueNumber: z.number().int().positive(),
  cueList: z.number().int().positive().default(1),
  fadeTime: z.number().min(0),
  notes: z.string().optional().default(""),
  channels: z.array(cueChannelSchema).min(1)
});

export const cueApprovalSchema = z.object({
  confirmDuplicate: z.boolean().optional().default(false),
  label: z.string().optional()
});
