import { useNetworkPolicy, type NetworkPolicy } from './useNetworkPolicy';

export type ImageQuality = 'high' | 'medium' | 'low';

interface QualityRecommendation {
  quality: ImageQuality;
  /** Suggested max width (px). UI should pass this to a CDN or to expo-image's
   *  width/height props so the source actually reflects the quality choice. */
  maxWidth: number;
  /** Suggested JPEG/WebP quality (0-100) for upload-side compression. */
  uploadQuality: number;
}

const QUALITY_BY_POLICY: Record<NetworkPolicy, QualityRecommendation> = {
  wifi: { quality: 'high', maxWidth: 2048, uploadQuality: 92 },
  cellular: { quality: 'medium', maxWidth: 1024, uploadQuality: 78 },
  metered: { quality: 'low', maxWidth: 640, uploadQuality: 60 },
  unknown: { quality: 'medium', maxWidth: 1024, uploadQuality: 78 },
  offline: { quality: 'low', maxWidth: 640, uploadQuality: 60 },
};

/**
 * Returns an image-quality recommendation based on the current network policy.
 *
 * Why a hook and not a constant: the answer changes mid-session (user
 * tethers, walks into a tunnel, toggles Low Data Mode). The hook re-renders
 * the screen with the new policy so newly-visible images request the
 * appropriate resolution.
 *
 * Use:
 *   const { maxWidth, uploadQuality } = useImageQuality();
 *   <Image source={`${cdn}/note/${id}?w=${maxWidth}`} />
 *
 * Pure mapping — no battery / RAM detection because RN doesn't expose
 * those reliably across iOS/Android. The network policy is the strongest
 * proxy we have for "the user is on something they care about saving".
 */
export const useImageQuality = (): QualityRecommendation => {
  const policy = useNetworkPolicy();
  return QUALITY_BY_POLICY[policy.policy] ?? QUALITY_BY_POLICY.unknown;
};

// Test helpers
export const _qualityForPolicy = (policy: NetworkPolicy): QualityRecommendation =>
  QUALITY_BY_POLICY[policy] ?? QUALITY_BY_POLICY.unknown;
export const _qualityPresets = QUALITY_BY_POLICY;
