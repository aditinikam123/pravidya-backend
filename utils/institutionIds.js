/**
 * Veman Academy / platform-scoped institution IDs (Jitofy).
 * PRV-F-000018 is the canonical ID used in URLs e.g. /venam/PRV-F-000018
 * PLATFORM is legacy; both resolve to the same scope (veeman academy, full platform access).
 */
export const VEMAN_JITOFY_INSTITUTION_ID = 'PRV-F-000018';
export const LEGACY_PLATFORM_JITOFY_ID = 'PLATFORM';

/** Case-insensitive: true if this institution is the platform / Veman scope */
export function isPlatformScope(inst) {
  const j = (inst?.jitofyInstitutionId || '').trim().toUpperCase();
  return j === LEGACY_PLATFORM_JITOFY_ID || j === VEMAN_JITOFY_INSTITUTION_ID.toUpperCase();
}

/** For slug resolution: PLATFORM and Veman ID both map to veeman academy */
export function academySlugForJitofyId(jitofyInstitutionId) {
  const j = (jitofyInstitutionId || '').trim().toUpperCase();
  if (j === LEGACY_PLATFORM_JITOFY_ID || j === VEMAN_JITOFY_INSTITUTION_ID.toUpperCase()) {
    return 'veeman';
  }
  return null;
}
