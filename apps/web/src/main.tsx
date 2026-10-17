import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClinicianPage } from "./routes/clinician/ClinicianPage";

// Only the clinician screen exists so far; patient and review routes come later.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClinicianPage />
  </StrictMode>,
);
