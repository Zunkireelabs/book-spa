import React, { useEffect } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { LockProvider } from "./contexts/LockContext";
import { OrgProvider } from "./contexts/OrgContext";
import { BranchProvider } from "./contexts/BranchContext";
import { AIAssistantProvider } from "./contexts/AIAssistantContext";
import { CustomerAuthProvider } from "./contexts/CustomerAuthContext";
import { AvailabilityOverrideProvider } from "./contexts/AvailabilityOverrideContext";
import Routes from "./Routes";
import { init as initAnalytics } from "./lib/analytics";

function App() {
  useEffect(() => { initAnalytics(); }, []);

  return (
    <AuthProvider>
      <LockProvider>
        <OrgProvider>
          <BranchProvider>
            <AIAssistantProvider>
              <CustomerAuthProvider>
                <AvailabilityOverrideProvider>
                  <Routes />
                </AvailabilityOverrideProvider>
              </CustomerAuthProvider>
            </AIAssistantProvider>
          </BranchProvider>
        </OrgProvider>
      </LockProvider>
    </AuthProvider>
  );
}

export default App;
