// Ansiktsanalyse for Mogg-off. Kjører helt i nettleseren med MediaPipe Face Landmarker.
//
// Poengsummen måler hvor godt du tar "chad-ansiktet" – ting du selv styrer:
// smale jegerøyne, senkede bryn, lukket/spent kjeve, null smil, rett blikk inn i kamera.
// Den sier ingenting om hvor pen noen er.
import { FaceLandmarker, FilesetResolver } from '/vendor/mediapipe/vision_bundle.mjs';

let landmarkerPromise = null;

function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/vendor/mediapipe/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
}

// Start nedlasting av modellen i bakgrunnen så analysen går raskere når den trengs
export function preload() {
  getLandmarker().catch(() => {});
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Klarte ikke å lese bildet.'));
    img.src = src;
  });
}

// Klipper ut et kvadrat rundt ansiktet til pallen/resultatet
function cropFace(img, lm) {
  const xs = lm.map((p) => p.x * img.naturalWidth);
  const ys = lm.map((p) => p.y * img.naturalHeight);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const side = Math.min(
    Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.7,
    img.naturalWidth,
    img.naturalHeight,
  );
  const sx = Math.max(0, Math.min(img.naturalWidth - side, cx - side / 2));
  const sy = Math.max(0, Math.min(img.naturalHeight - side, cy - side / 2));
  const out = 480;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, out, out);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function verdict(score) {
  if (score >= 9.5) return 'MEGA CHAD 🗿🔥';
  if (score >= 8) return 'Chad 🗿';
  if (score >= 6.5) return 'Sigma i emning 😤';
  if (score >= 5) return 'Normie 😐';
  if (score >= 3) return 'Blir mogget 😬';
  return 'Mogget i hjel 💀';
}

export const PART_LABELS = {
  eyes: '👁️ Jegerøyne',
  brow: '🤨 Intense bryn',
  jaw: '🦴 Kjevelinje (lukket, spent)',
  stone: '🗿 Steinansikt (null smil)',
  frame: '📐 Rett i kamera',
};

// file: bilde fra kamera. Returnerer { score, parts, image, verdict }
export async function analyzeFace(file, resizeImage) {
  const dataUrl = await resizeImage(file, 960, 0.9);
  const [landmarker, img] = await Promise.all([getLandmarker(), loadImage(dataUrl)]);
  const result = landmarker.detect(img);
  if (!result.faceLandmarks || !result.faceLandmarks.length) {
    throw new Error('Fant ikke noe ansikt 🤔 Ta et nytt bilde med ansiktet godt synlig.');
  }
  const lm = result.faceLandmarks[0];
  const bs = {};
  (result.faceBlendshapes[0]?.categories || []).forEach((c) => (bs[c.categoryName] = c.score));
  const avg = (a, b) => ((bs[a] || 0) + (bs[b] || 0)) / 2;

  // Jegerøyne: myse, men ikke lukke øynene
  const squint = avg('eyeSquintLeft', 'eyeSquintRight');
  const blink = avg('eyeBlinkLeft', 'eyeBlinkRight');
  const eyes = blink > 0.6 ? 0 : clamp01((squint - 0.15) / 0.75) * (1 - clamp01((blink - 0.35) / 0.25));

  // Intense bryn: senket, ikke bekymret
  const brow = clamp01(avg('browDownLeft', 'browDownRight') / 0.75 - (bs.browInnerUp || 0) * 0.8);

  // Kjeve: munnen lukket og gjerne litt sammenpresset
  const closed = 1 - clamp01((bs.jawOpen || 0) / 0.2);
  const press = clamp01(avg('mouthPressLeft', 'mouthPressRight') / 0.4);
  const jaw = closed * (0.65 + 0.35 * press);

  // Steinansikt: null smil
  const stone = 1 - clamp01(avg('mouthSmileLeft', 'mouthSmileRight') / 0.4);

  // Rett i kamera: ikke snu eller vippe hodet, og ansiktet skal fylle bildet godt
  const nose = lm[1];
  const eyeL = lm[33];
  const eyeR = lm[263];
  const eyeDist = Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y) || 1e-6;
  const yaw = Math.abs((nose.x - (eyeL.x + eyeR.x) / 2) / eyeDist);
  const roll = Math.abs((Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x) * 180) / Math.PI);
  const xs = lm.map((p) => p.x);
  const faceWidth = Math.max(...xs) - Math.min(...xs);
  const size = faceWidth < 0.3 ? clamp01((faceWidth - 0.12) / 0.18) : 1;
  // Litt slingringsmonn før det trekkes: under ~5° tilt og litt sidevending er helt greit
  const frame = (1 - clamp01((yaw - 0.08) / 0.4)) * (1 - clamp01((roll - 5) / 30)) * size;

  const parts = { eyes, brow, jaw, stone, frame };
  const raw = eyes * 0.25 + brow * 0.2 + jaw * 0.2 + stone * 0.15 + frame * 0.2;
  // Kurven gjør toppen bratt: 10.00 krever et nesten perfekt chad-ansikt
  const score = Math.floor(10 * Math.pow(clamp01(raw), 1.5) * 100) / 100;

  const shown = {};
  Object.entries(parts).forEach(([k, v]) => (shown[k] = Math.round(v * 100) / 10));
  return { score, parts: shown, image: cropFace(img, lm), verdict: verdict(score) };
}
