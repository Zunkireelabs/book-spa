import React from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { BranchProvider } from "./contexts/BranchContext";
import { AIAssistantProvider } from "./contexts/AIAssistantContext";
import Routes from "./Routes";

function App() {
  return (
    <AuthProvider>
      <BranchProvider>
        <AIAssistantProvider>
          <Routes />
        </AIAssistantProvider>
      </BranchProvider>
    </AuthProvider>
  );
}

export default App;
