#!/usr/bin/env bash
# Download MediaPipe model files into apps/pointing/models/ (gitignored).
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/models"
mkdir -p "$dir"
base="https://storage.googleapis.com/mediapipe-models"
fetch() {
  if [[ ! -f "$dir/$1" ]]; then
    curl -fL --retry 3 -o "$dir/$1" "$base/$2"
  fi
}
fetch hand_landmarker.task hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
fetch pose_landmarker_lite.task pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
echo "Models in $dir"
