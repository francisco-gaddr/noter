import { gguf } from "@huggingface/gguf";

export interface GGUFInfo {
  metadata: Record<string, any>;
  tensorCount: number;
  version: number;
  architecture?: string;
  contextLength?: number;
  quantizationVersion?: number;
}

export const parseGGUF = async (urlOrPath: string): Promise<GGUFInfo> => {
  try {
    // The library handles both remote URLs (via Range headers) and local paths (if supported by environment)
    // For remote URLs, it fetches only necessary bytes.
    const { metadata } = await gguf(urlOrPath);
    const metadataRecord = metadata as Record<string, any>;

    // Extract common useful fields for easier access
    const architecture = metadataRecord['general.architecture'] as string;
    const contextLength = architecture ? metadataRecord[`${architecture}.context_length`] as number : undefined;
    const quantizationVersion = metadataRecord['general.quantization_version'] as number | undefined;

    return {
      metadata: metadataRecord,
      tensorCount: Number(metadataRecord.tensor_count || 0),
      version: Number(metadataRecord.version || 0),
      architecture,
      contextLength,
      quantizationVersion,
    };
  } catch (error) {
    console.error("Failed to parse GGUF:", error);
    throw error;
  }
};
