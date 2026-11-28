import { useOrg } from '../../../contexts/OrgContext';

// What the bill needs from the org, from data that already exists: name, logo (if any), Settings → Billing footer text.
export function useBillOrg() {
  const { orgName, orgLogoUrl, orgSettings, multiServiceBookings } = useOrg();
  return { multi: multiServiceBookings, billingOn: orgSettings?.billing_enabled === true, orgInfo: { name: orgName, logoUrl: orgLogoUrl, footer: orgSettings?.billing_footer_text || '' } };
}
