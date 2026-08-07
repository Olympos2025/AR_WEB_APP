import * as THREE from 'three';

/**
 * Builds a screen-space label sprite from a canvas texture. With
 * `sizeAttenuation: false` the label keeps a constant pixel size, so it stays
 * readable at any distance.
 */
export function createLabelSprite(text: string, color: string, sizeMultiplier: number): THREE.Sprite | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fontSize = 44;
  const padding = 18;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const metrics = ctx.measureText(trimmed);
  canvas.width = Math.ceil(metrics.width + padding * 2);
  canvas.height = fontSize + padding * 2;

  const context = canvas.getContext('2d')!;
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  drawRoundedRect(context, 0, 0, canvas.width, canvas.height, 14, 'rgba(15, 23, 42, 0.72)');
  context.fillStyle = color;
  context.fillText(trimmed, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: false,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  // sizeAttenuation:false sprite scale is in NDC-ish units; keep labels small.
  const base = 0.0006 * sizeMultiplier;
  sprite.scale.set(canvas.width * base, canvas.height * base, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
