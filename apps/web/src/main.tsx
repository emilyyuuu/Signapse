import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HomePage } from "./routes/HomePage";
import { ClinicianPage } from "./routes/clinician/ClinicianPage";
import { PatientPage } from "./routes/patient/PatientPage";
import { ReviewPage } from "./routes/review/ReviewPage";
import { DoctorCallPage } from "./routes/call/DoctorCallPage";
import { PatientCallPage } from "./routes/call/PatientCallPage";
import { WizardPage } from "./wizard/WizardPage";
import { RecordPage } from "./routes/record/RecordPage";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles/tokens.css";

// Minimal routing by path; the encounter id rides along as ?e=<id>.
function App() {
  const path = location.pathname;
  if (path.startsWith("/patient")) return <PatientPage />;
  if (path.startsWith("/clinician")) return <ClinicianPage />;
  if (path.startsWith("/review")) return <ReviewPage />;
  if (path.startsWith("/wizard")) return <WizardPage />;
  if (path.startsWith("/record")) return <RecordPage />;
  if (path.startsWith("/call/doctor")) return <DoctorCallPage />;
  if (path.startsWith("/call")) return <PatientCallPage />;
  return <HomePage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
