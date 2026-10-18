/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CAMERA_URL?: string;
  // Optional TURN relay for calls between networks that block direct connections.
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USER?: string;
  readonly VITE_TURN_PASS?: string;
}
