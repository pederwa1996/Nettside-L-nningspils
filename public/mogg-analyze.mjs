// Ansiktsanalyse for Mogg-off. Kjører helt i nettleseren med MediaPipe Face Landmarker.
//
// Poengsummen måler hvor godt du kopierer Giga Chad – ting du selv styrer:
// selvsikkert smirk, myse jegerøyne med blikket til siden, senkede bryn, hodet vridd og vippet.
// Referansen er målt med samme modell på det klassiske Giga Chad-bildet (smil ≈ 0,65, myse ≈ 0,3,
// blikk til siden ≈ 0,45, hodet ≈ 24° vridd og ≈ 11° vippet). Speilvendt (vridd andre veien) teller likt.
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
  if (score >= 9.5) return 'GIGA CHAD 🗿🔥';
  if (score >= 8) return 'Chad 🗿';
  if (score >= 6.5) return 'Sigma i emning 😤';
  if (score >= 5) return 'Normie 😐';
  if (score >= 3) return 'Blir mogget 😬';
  return 'Mogget i hjel 💀';
}

// Nøklene er de samme som før (serveren lagrer dem), men måler nå Giga Chad-posen
export const PART_LABELS = {
  jaw: '😏 Smirket',
  eyes: '👁️ Chad-blikket (myse, se til siden)',
  brow: '🤨 Senkede bryn',
  frame: '↗️ Vinkelen (hodet vridd)',
  stone: '📐 Hodetilten',
};

// Full pott innenfor et område, og en myk nedtrapping utenfor
function band(x, lo, hi, below, above) {
  if (x < lo) return clamp01(1 - (lo - x) / below);
  if (x > hi) return clamp01(1 - (x - hi) / above);
  return 1;
}

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

  // 😏 Smirket: et selvsikkert smil (Giga Chad ≈ 0,65), gjerne med litt tenner, men ikke gapende
  const smile = Math.max(avg('mouthSmileLeft', 'mouthSmileRight'), Math.max(bs.mouthSmileLeft || 0, bs.mouthSmileRight || 0) * 0.9); // skjevt smirk teller
  const teeth = clamp01((avg('mouthUpperUpLeft', 'mouthUpperUpRight') + avg('mouthLowerDownLeft', 'mouthLowerDownRight')) / 0.12);
  const gape = clamp01(((bs.jawOpen || 0) - 0.22) / 0.3);
  const jaw = band(smile, 0.4, 0.85, 0.35, 0.3) * (0.8 + 0.2 * teeth) * (1 - gape);

  // 👁️ Chad-blikket: myse (≈ 0,3) uten å lukke øynene, og se til siden (ikke rett i kamera)
  const squint = avg('eyeSquintLeft', 'eyeSquintRight');
  const blink = avg('eyeBlinkLeft', 'eyeBlinkRight');
  const squintScore = blink > 0.65 ? 0 : band(squint, 0.18, 0.6, 0.18, 0.35) * (1 - clamp01((blink - 0.45) / 0.2));
  const side = Math.max(avg('eyeLookOutLeft', 'eyeLookInRight'), avg('eyeLookInLeft', 'eyeLookOutRight'));
  const glance = clamp01(side / 0.3);
  const eyes = squintScore * 0.75 + glance * 0.25;

  // 🤨 Senkede bryn, ikke bekymret eller overrasket
  const browDown = avg('browDownLeft', 'browDownRight');
  const worried = clamp01(((bs.browInnerUp || 0) - 0.25) / 0.4) + clamp01((avg('browOuterUpLeft', 'browOuterUpRight') - 0.3) / 0.4);
  const brow = clamp01(0.45 + browDown / 0.15) * (1 - clamp01(worried));

  // ↗️ Vinkelen og 📐 tilten: Giga Chad er vridd ca. 24° og vippet ca. 11° (begge veier teller)
  const nose = lm[1];
  const eyeL = lm[33];
  const eyeR = lm[263];
  const eyeDist = Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y) || 1e-6;
  const yaw = Math.abs((nose.x - (eyeL.x + eyeR.x) / 2) / eyeDist);
  const roll = Math.abs((Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x) * 180) / Math.PI);
  const xs = lm.map((p) => p.x);
  const faceWidth = Math.max(...xs) - Math.min(...xs);
  const size = faceWidth < 0.25 ? clamp01((faceWidth - 0.1) / 0.15) : 1;
  const frame = band(yaw, 0.14, 0.45, 0.14, 0.3) * size;
  const stone = band(roll, 5, 22, 7, 20);

  const parts = { eyes, brow, jaw, stone, frame };
  const raw = jaw * 0.3 + eyes * 0.25 + frame * 0.2 + stone * 0.13 + brow * 0.12;
  // Giga Chad selv havner rundt 9,5–10. Litt bratt i toppen, så 10.00 krever en nesten perfekt kopi.
  const score = Math.floor(10 * Math.pow(clamp01(raw), 1.25) * 100) / 100;

  const shown = {};
  Object.entries(parts).forEach(([k, v]) => (shown[k] = Math.round(v * 100) / 10));
  return { score, parts: shown, image: cropFace(img, lm), verdict: verdict(score) };
}
