export type ToolChainCall = {
  tool: string;
  arguments?: Record<string, any>;
};

export const toToolCallKeys = (calls: ToolChainCall[]) =>
  calls.map((call) => `${call.tool}:${JSON.stringify(call.arguments || {})}`);

export const toToolIterationSignature = (cleanedText: string, fullText: string, callKeys: string[]) =>
  `${(cleanedText || fullText || '').trim()}::${callKeys.join('|')}`;

export const shouldStopToolIteration = (
  signature: string,
  callKeys: string[],
  iterationSignatures: Set<string>,
  executedCallKeys: Set<string>
) => {
  if (iterationSignatures.has(signature)) return true;
  iterationSignatures.add(signature);
  if (callKeys.length === 0) return false;
  const hasNewCall = callKeys.some((key) => !executedCallKeys.has(key));
  if (!hasNewCall) return true;
  callKeys.forEach((key) => executedCallKeys.add(key));
  return false;
};
