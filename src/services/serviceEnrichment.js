const SERVICE_UI_DATA = {
  'Deep Tissue Massage': {
    image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=300&fit=crop',
    benefits: ['Relieves muscle tension', 'Improves circulation', 'Reduces stress'],
    therapistPreference: ['male', 'female'],
    category: 'Therapeutic',
    popularity: 'Most Popular',
    specialty: null,
  },
  'Swedish Massage': {
    image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop',
    benefits: ['Full body relaxation', 'Stress relief', 'Improved sleep'],
    therapistPreference: ['male', 'female'],
    category: 'Relaxation',
    popularity: null,
    specialty: null,
  },
  'Hot Stone Therapy': {
    image: 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=400&h=300&fit=crop',
    benefits: ['Deep muscle relaxation', 'Improved circulation', 'Pain relief'],
    therapistPreference: ['female'],
    category: 'Specialty',
    popularity: null,
    specialty: null,
  },
  'Aromatherapy Massage': {
    image: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=400&h=300&fit=crop',
    benefits: ['Emotional balance', 'Stress reduction', 'Enhanced mood'],
    therapistPreference: ['female'],
    category: 'Wellness',
    popularity: null,
    specialty: null,
  },
  'Traditional Thai Massage': {
    image: 'https://images.pexels.com/photos/3757942/pexels-photo-3757942.jpeg?w=400&h=300&fit=crop',
    benefits: ['Increased flexibility', 'Energy boost', 'Pain relief'],
    therapistPreference: ['male', 'female'],
    category: 'Traditional',
    popularity: null,
    specialty: 'Signature Service',
  },
  'Couples Massage': {
    image: 'https://images.pixabay.com/photo/2016/11/08/05/26/woman-1807533_1280.jpg?w=400&h=300&fit=crop',
    benefits: ['Shared relaxation', 'Bonding experience', 'Stress relief'],
    therapistPreference: ['male', 'female'],
    category: 'Couples',
    popularity: null,
    specialty: null,
  },
  'Prenatal Massage': {
    image: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=400&h=300&fit=crop',
    benefits: ['Reduces swelling', 'Relieves back pain', 'Improves sleep'],
    therapistPreference: ['female'],
    category: 'Specialty',
    popularity: null,
    specialty: null,
  },
  'Foot Reflexology': {
    image: 'https://images.pexels.com/photos/6663515/pexels-photo-6663515.jpeg?w=400&h=300&fit=crop',
    benefits: ['Improved circulation', 'Stress relief', 'Better sleep'],
    therapistPreference: ['male', 'female'],
    category: 'Therapeutic',
    popularity: null,
    specialty: null,
  },
};

const DEFAULT_UI_DATA = {
  image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=300&fit=crop',
  benefits: ['Relaxation', 'Stress relief'],
  therapistPreference: ['male', 'female'],
  category: 'General',
  popularity: null,
  specialty: null,
};

// One representative photo per service category (Nuad Thai Spa), used when a
// service has no per-service entry above and no image_url of its own — so
// e.g. every "Spa" service doesn't all fall back to one unrelated default
// photo. Falls back further to DEFAULT_UI_DATA.image for any category
// without a photo yet.
const CATEGORY_IMAGES = {
  Spa: '/assets/images/categories/spa.webp',
  Salon: '/assets/images/categories/salon.webp',
  'Hair Color': '/assets/images/categories/hair-color.webp',
  Nail: '/assets/images/categories/nail.webp',
  Waxing: '/assets/images/categories/waxing.webp',
  Threading: '/assets/images/categories/threading.webp',
  Facial: '/assets/images/categories/facial.webp',
  'Hair Treatment': '/assets/images/categories/hair-treatment.webp',
};

// Within the Packages category specifically, match by theme instead of one
// generic Packages fallback for all of them — checked in order, first match
// wins. Membership/Customized/Complete Wellness packages get a spa-room
// photo; massage/annual/couple-themed packages (e.g. "Annual Package -
// 60min", "Couple Massage Wellness Date") get a massage photo — but a
// hair-related package (e.g. "Men's Hair Cut Package") never should, even if
// its name happens to also match one of these words.
const PACKAGE_SUBTOPIC_IMAGES = [
  {
    test: (name) => /men.*hair cut/i.test(name),
    image: '/assets/images/categories/salon-men.webp',
  },
  {
    test: (name) => /gift voucher|worth voucher/i.test(name),
    image: '/assets/images/categories/voucher.webp',
  },
  {
    test: (name) => /membership|customized|complete wellness/i.test(name),
    image: '/assets/images/services/spa-room-package.webp',
  },
  {
    test: (name) => /massage|annual|couple/i.test(name) && !/hair/i.test(name),
    image: '/assets/images/services/massage-package.webp',
  },
  {
    test: (name) => /teej|mother.?s day/i.test(name),
    image: '/assets/images/categories/teej-mothers-day.webp',
  },
];

// Within Other, match by sub-topic the same way as Wellness/Salon — the
// generic "Other" fallback bucket otherwise lumps a gift hamper in with a
// VIP room surcharge with a bottled water add-on.
const OTHER_SUBTOPIC_IMAGES = [
  { test: /gift hamper/i, image: '/assets/images/categories/voucher.webp' },
  { test: /vip room/i, image: '/assets/images/categories/vip-room.webp' },
  { test: /^products$/i, image: '/assets/images/categories/product.webp' },
  { test: /deep tissue/i, image: '/assets/images/categories/deep-tissue.webp' },
];

// Within Wellness, match by sub-topic in the service name (Jacuzzi/Sauna/
// Steam/Herbal all currently share one generic category fallback, even
// though they're visually nothing alike) — checked in order, first match
// wins.
const WELLNESS_SUBTOPIC_IMAGES = [
  { test: /sauna/i, image: '/assets/images/categories/sauna.webp' },
  { test: /jacuzzi/i, image: '/assets/images/categories/jacuzzi.webp' },
  { test: /herbal/i, image: '/assets/images/categories/herbal.webp' },
  { test: /steam/i, image: '/assets/images/categories/steam.webp' },
];

// Within Salon, services are named with a "Men - " / "Women - " prefix
// (e.g. "Men - Beard Trim", "Women - Hair Cut") — match a photo of the
// right gender instead of one generic salon photo for both. Anything
// without either prefix keeps the neutral CATEGORY_IMAGES.Salon fallback.
const SALON_SUBTOPIC_IMAGES = [
  { test: /^men\b/i, image: '/assets/images/categories/salon-men.webp' },
  { test: /^women\b/i, image: '/assets/images/categories/salon-women.webp' },
];

export function enrichService(dbService) {
  const uiData = SERVICE_UI_DATA[dbService.name] || DEFAULT_UI_DATA;
  const packageImage =
    dbService.category === 'Packages'
      ? PACKAGE_SUBTOPIC_IMAGES.find((p) => p.test(dbService.name))?.image
      : null;
  const wellnessImage =
    dbService.category === 'Wellness'
      ? WELLNESS_SUBTOPIC_IMAGES.find((p) => p.test.test(dbService.name))?.image
      : null;
  const salonImage =
    dbService.category === 'Salon'
      ? SALON_SUBTOPIC_IMAGES.find((p) => p.test.test(dbService.name))?.image
      : null;
  const otherImage =
    dbService.category === 'Other'
      ? OTHER_SUBTOPIC_IMAGES.find((p) => p.test.test(dbService.name))?.image
      : null;

  return {
    id: dbService.id,
    name: dbService.name,
    description: dbService.description,
    duration: `${dbService.duration_minutes} minutes`,
    durationMinutes: dbService.duration_minutes,
    price: Number(dbService.price_npr),
    // Prefer database image_url, then a themed-package/wellness/salon/other-subtopic photo, then a per-category photo, then the hardcoded fallback
    image: dbService.image_url || packageImage || wellnessImage || salonImage || otherImage || CATEGORY_IMAGES[dbService.category] || uiData.image,
    benefits: uiData.benefits,
    therapistPreference: uiData.therapistPreference,
    // Prefer database category over hardcoded fallback
    category: dbService.category || uiData.category,
    popularity: uiData.popularity,
    specialty: uiData.specialty,
    // Offer/campaign pricing — present when the source data includes them
    // (fetchBookableServicesByOrgSlug); undefined otherwise, so existing
    // callers that don't fetch these fields are unaffected.
    isOnOffer: dbService.is_on_offer,
    effectivePrice: dbService.effective_price_npr != null ? Number(dbService.effective_price_npr) : undefined,
    originalPrice: dbService.original_price_npr != null ? Number(dbService.original_price_npr) : undefined,
    activeCampaignName: dbService.active_campaign_name,
  };
}

export function enrichServices(dbServices) {
  return dbServices.map(enrichService);
}
