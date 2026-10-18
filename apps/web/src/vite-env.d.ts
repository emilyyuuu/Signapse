/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CAMERA_URL?: string;
  // Camera helper on the patient laptop (apps/pointing/launcher.py).
  readonly VITE_LAUNCHER_URL?: string;
  // Optional TURN relay for calls between networks that block direct connections.
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USER?: string;
  readonly VITE_TURN_PASS?: string;
}
