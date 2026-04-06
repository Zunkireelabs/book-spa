import React from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { OrgProvider } from "./contexts/OrgContext";
import { BranchProvider } from "./contexts/BranchContext";
import { AIAssistantProvider } from "./contexts/AIAssistantContext";
import Routes from "./Routes";

function App() {
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
