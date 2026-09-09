import type { NativeImage } from "electron";

// Sample the center of the actual composited game image, excluding toolbar and
// HUD edges. A loaded message or a nonempty PNG alone can still be a black canvas.
export function checkCraftmineFrame(image: NativeImage): { coloredSamples: number; samples: number } {
  const { width, height } = image.getSize();
  if (width < 100 || height < 100) throw new Error("EMPTY_VERIFICATION_CAPTURE");
  const pixels = image.toBitmap();
  let coloredSamples = 0;
  for (let y = 3; y <= 7; y++) for (let x = 2; x <= 8; x++) {
    const offset = (Math.floor(height * y / 10) * width + Math.floor(width * x / 10)) * 4;
    if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 30) coloredSamples++;
  }
  if (coloredSamples < 18) throw new Error("BLANK_GAME_FRAME");
  return { coloredSamples, samples: 35 };
}
