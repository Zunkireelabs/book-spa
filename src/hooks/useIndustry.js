import { useOrg } from '../contexts/OrgContext';

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

    // Helper checks for industry type
    isSpa: industryType === 'spa',
    isCleaning: industryType === 'cleaning',
    isSalon: industryType === 'salon',
    isBeauty: industryType === 'beauty',
  };
};

export default useIndustry;
