import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte address")
  .transform((v) => v as `0x${string}`);

const selectorSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{8}$/, "must be a 4-byte 0x-prefixed selector")
  .transform((v) => v as `0x${string}`);

const hexSchema = z
  .string()
  .regex(/^0x(?:[a-fA-F0-9]{2})*$/, "must be 0x-prefixed byte-aligned hex")
  .transform((v) => v as `0x${string}`);

export const policyRulesSchema = z.object({
  maxTransferEth: z.number().nonnegative().optional(),
  maxDailyOutflowEth: z.number().nonnegative().optional(),
  allowedDestinations: z.array(addressSchema).optional(),
  forbiddenSelectors: z.array(selectorSchema).optional(),
  maxSlippageBps: z.number().int().min(0).max(10_000).optional(),
  approvalCapByToken: z
    .record(addressSchema, z.string().regex(/^\d+$/, "approval cap must be a decimal wei string"))
    .optional(),
});

export const policyRemediationSchema = z.object({
  onBlock: z.array(z.string()).optional(),
  onAnomaly: z.array(z.string()).optional(),
  notifyChannels: z.array(z.string()).optional(),
});

export const policyInputSchema = z.object({
  owner: addressSchema,
  rules: policyRulesSchema,
  remediation: policyRemediationSchema.default({}),
});

export const txIntentSchema = z.object({
  from: addressSchema,
  to: addressSchema,
  value: z.string().regex(/^\d+$/, "value must be decimal wei string"),
  data: hexSchema,
  chainId: z.number().int().positive(),
  nonce: z.number().int().nonnegative().optional(),
  gas: z.string().regex(/^\d+$/).optional(),
});

export const evaluateRequestSchema = z.object({
  policyId: z.string(),
  intent: txIntentSchema,
});

export type PolicyInput = z.infer<typeof policyInputSchema>;
export type EvaluateRequest = z.infer<typeof evaluateRequestSchema>;
