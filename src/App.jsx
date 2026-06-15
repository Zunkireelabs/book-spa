import React, { useEffect } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { OrgProvider } from "./contexts/OrgContext";
import { BranchProvider } from "./contexts/BranchContext";
import { AIAssistantProvider } from "./contexts/AIAssistantContext";
import Routes from "./Routes";
import { init as initAnalytics } from "./lib/analytics";

function App() {
  useEffect(() => { initAnalytics(); }, []);

  return (
    <AuthProvider>
      <OrgProvider>
        <BranchProvider>
          <AIAssistantProvider>
            <Routes />
          </AIAssistantProvider>
        </BranchProvider>
      </OrgProvider>
    </AuthProvider>
  );
}

export default App;
