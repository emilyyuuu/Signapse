import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_URL } from "../components/camera/CameraPanel";

export type VideoSource = "preview" | "webcam" | "none";

const WIDTH = 640;
const HEIGHT = 480;
const FPS = 15;

// The patient's outgoing call video. The local sign-reading program (apps/pointing)
// usually holds the webcam, so its picture is drawn onto a canvas and the canvas is
// sent. Without that program the patient can use the webcam directly (no sign
// reading). The canvas stream never changes, so switching source needs no
// renegotiation with the doctor.
export function usePatientVideo() {
  const [source, setSource] = useState<VideoSource>("none");
  const [stream, setStream] = useState<MediaStream>();
  const [webcamError, setWebcamError] = useState<string>();
  const webcam = useRef<{ stream: MediaStream; video: HTMLVideoElement }>();
  const preview = useRef<HTMLImageElement>();

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d")!;

    // The MJPEG picture only keeps updating while the image is in the page.
    const img = document.createElement("img");
    img.crossOrigin = "anonymous"; // the preview allows it, so the canvas stays readable
    img.alt = "";
    Object.assign(img.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(img);
    preview.current = img;

    const draw = (el: CanvasImageSource, w: number, h: number) => {
      const scale = Math.min(WIDTH / w, HEIGHT / h);
      const dw = w * scale;
      const dh = h * scale;
      ctx.drawImage(el, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh);
    };

    const tick = () => {
      ctx.fillStyle = "#11151c";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const cam = webcam.current;
      if (cam && cam.video.videoWidth) {
        draw(cam.video, cam.video.videoWidth, cam.video.videoHeight);
        setSource("webcam");
      } else if (img.src && img.complete && img.naturalWidth) {
        draw(img, img.naturalWidth, img.naturalHeight);
        setSource("preview");
      } else {
        ctx.fillStyle = "#8a94a6";
        ctx.font = "500 22px Inter Variable, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Camera off", WIDTH / 2, HEIGHT / 2);
        setSource("none");
      }
    };
    const timer = setInterval(tick, 1000 / FPS);
    tick();

    // Watch for the sign-reading program's picture.
    let stopped = false;
    const check = async () => {
      let on = false;
      try {
        on = (await fetch(`${CAMERA_URL}/status`, { signal: AbortSignal.timeout(1500) })).ok;
      } catch {
        on = false;
      }
      if (stopped) return;
      if (on && !img.src) img.src = `${CAMERA_URL}/video?t=${Date.now()}`;
      if (!on && img.src) img.removeAttribute("src");
    };
    void check();
    const poll = setInterval(check, 2000);

    setStream(canvas.captureStream(FPS));

    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(poll);
      img.removeAttribute("src");
      img.remove();
      webcam.current?.stream.getTracks().forEach((t) => t.stop());
      webcam.current = undefined;
    };
  }, []);

  // Video only, without sign reading: use the webcam in the browser.
  const useWebcam = useCallback(async () => {
    setWebcamError(undefined);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = s;
      await video.play();
      webcam.current = { stream: s, video };
    } catch {
      setWebcamError("The camera is busy or blocked. Check the browser's camera permission.");
    }
  }, []);

  // Frees the webcam, e.g. before the sign-reading program starts and needs it.
  const releaseWebcam = useCallback(() => {
    webcam.current?.stream.getTracks().forEach((t) => t.stop());
    webcam.current = undefined;
  }, []);

  return { stream, source, useWebcam, releaseWebcam, webcamError };
}
