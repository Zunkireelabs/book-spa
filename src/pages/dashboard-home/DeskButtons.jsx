import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { viewerAccess } from '../../services/dataMasking';
import Button from '../../components/ui/Button';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED } from '../../lib/featureFlags';

/** The front-desk buttons, same order everywhere (Front desk, Branch view): New booking · Check booking · Collect payment · Walk-in. */
const DeskButtons = ({ onNew, onWalkIn, onGo, extras = false }) => {
  const { profile } = useAuth();
  const money = viewerAccess(profile).canViewPrices; // ZNLY-235: no money buttons for a no-prices login
  return (
  <div className="flex flex-wrap gap-2">
    <Button size="sm" variant="primary" iconName="Plus" onClick={onNew}>New booking</Button>
    <Button size="sm" variant="outline" iconName="Search" onClick={() => onGo('check-booking')}>Check booking</Button>
    {money && <Button size="sm" variant="outline" iconName="HandCoins" onClick={() => onGo('collect-payment')}>Collect payment</Button>}
    <Button size="sm" variant="outline" iconName="DoorOpen" onClick={onWalkIn}>Walk-in</Button>
    {extras && money && MEMBERSHIP_ENABLED && <Button size="sm" variant="outline" iconName="CreditCard" onClick={() => onGo('new-membership')}>New membership</Button>}
    {extras && money && VOUCHER_ENABLED && <Button size="sm" variant="outline" iconName="Ticket" onClick={() => onGo('new-voucher')}>New voucher</Button>}
  </div>
  );
};

export default DeskButtons;
