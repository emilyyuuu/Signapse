import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HomePage } from "./routes/HomePage";
import { ClinicianPage } from "./routes/clinician/ClinicianPage";
import { PatientPage } from "./routes/patient/PatientPage";
import { ReviewPage } from "./routes/review/ReviewPage";
import "./styles/tokens.css";

// Minimal routing by path; the encounter id rides along as ?e=<id>.
function App() {
  const path = location.pathname;
  if (path.startsWith("/patient")) return <PatientPage />;
  if (path.startsWith("/clinician")) return <ClinicianPage />;
  if (path.startsWith("/review")) return <ReviewPage />;
  return <HomePage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
