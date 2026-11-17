// Example text for placeholders, so an org sees examples from its own trade. Spa strings are the originals.
const EXAMPLES = {
  spa: { service: 'Deep Tissue Massage', category: 'Massage, Hair, Wellness', extra: 'Hot towel upgrade', voucher: 'Full Body Oil Massage · 60 min', product: 'Lavender massage oil' },
  beauty: { service: 'Brow Threading', category: 'Brows, Lashes, Nails', extra: 'Nail art upgrade', voucher: 'Gel Manicure · 45 min', product: 'Nourishing cuticle oil' },
  salon: { service: 'Haircut & Blow-dry', category: 'Hair, Colour, Styling', extra: 'Scalp treatment', voucher: 'Cut & Colour · 90 min', product: 'Argan hair oil' },
  cleaning: { service: 'Deep Home Clean', category: 'Home, Office, Move-out', extra: 'Inside the oven', voucher: 'Deep Home Clean · 3 hrs', product: 'Eco floor cleaner' },
};

export const industryExamples = (industryType) => EXAMPLES[industryType] || EXAMPLES.spa;
