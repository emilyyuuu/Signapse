#!/usr/bin/env bash
# Download MediaPipe model files into vision/models/ (gitignored).
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/models"
mkdir -p "$dir"
url="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
if [[ ! -f "$dir/face_landmarker.task" ]]; then
  curl -fL --retry 3 -o "$dir/face_landmarker.task" "$url"
fi
echo "Models in $dir"
