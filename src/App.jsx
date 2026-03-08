import React from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { BranchProvider } from "./contexts/BranchContext";
import Routes from "./Routes";

function App() {
  return (
    <AuthProvider>
      <BranchProvider>
        <Routes />
      </BranchProvider>
    </AuthProvider>
  );
}

export default App;
