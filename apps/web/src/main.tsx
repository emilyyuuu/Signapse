import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
  return (
    <main className="page">
      <h1>Synapse</h1>
      <p>
        <a href={`/patient${location.search}`}>Patient screen</a> ·{" "}
        <a href={`/clinician${location.search}`}>Clinician screen</a> ·{" "}
        <a href={`/review${location.search}`}>Chart review</a>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
