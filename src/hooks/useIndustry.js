import { useOrg } from '../contexts/OrgContext';
import { industryExamples } from '../utils/industryExamples';

/**
 * Hook for accessing industry-specific configuration
 * Provides terminology, feature flags, and industry type checks
 */
export const useIndustry = () => {
  const {
    industry,
    industryType,
    staffLabel,
    staffLabelPlural,
    locationLabel,
    locationLabelPlural,
    sessionLabel,
    sessionLabelPlural,
    enableRooms,
    enableStaffGender,
    enableSpecialties,
    enableCustomerGender,
    defaultCategories,
    productLabel,
    defaultProductCategories,
    productsSoldByDefault,
  } = useOrg();

  return {
    // Raw industry data
    industry,
    industryType,

    // Terminology
    staffLabel,
    staffLabelPlural,
    locationLabel,
    locationLabelPlural,
    sessionLabel,
    sessionLabelPlural,

    // Feature flags
    enableRooms,
    enableStaffGender,
    enableSpecialties,
    enableCustomerGender,

    // Default categories for this industry
    defaultCategories,

    // Products wording and defaults (migration-345)
    productLabel,
    defaultProductCategories,
    productsSoldByDefault,

    // One word for a business site. Spa keeps its own "branch"; other trades say "location", as the Locations page does.
    branchWord: industryType === 'spa' ? 'branch' : 'location',
    branchWordPlural: industryType === 'spa' ? 'branches' : 'locations',

    // The word for the service part of a bill (vs products). Spa keeps "Treatment"; other trades use their own session word.
    treatmentWord: industryType === 'spa' ? 'Treatment' : sessionLabel,
    treatmentWordLower: (industryType === 'spa' ? 'Treatment' : sessionLabel || 'Session').toLowerCase(),

    // Placeholder examples from this org's own trade
    examples: industryExamples(industryType),

    // Helper checks for industry type
    isSpa: industryType === 'spa',
    isCleaning: industryType === 'cleaning',
    isSalon: industryType === 'salon',
    isBeauty: industryType === 'beauty',
  };
};

export default useIndustry;
