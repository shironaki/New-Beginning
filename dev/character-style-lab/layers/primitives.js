import { palette } from './palette.js';

export function path(ctx, draw, fill, stroke = palette.ink, lineWidth = 2) {
  ctx.beginPath();
  draw(ctx);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
}

export function line(ctx, points, color, width, cap = 'round') {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function limb(ctx, points, color, width, outline = palette.ink) {
  const coords = points.map(([x, y]) => ({ x, y }));
  const left = [];
  const right = [];
  for (let i = 0; i < coords.length; i += 1) {
    const previous = coords[Math.max(0, i - 1)];
    const next = coords[Math.min(coords.length - 1, i + 1)];
    let dx = next.x - previous.x;
    let dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length; dy /= length;
    const taper = i === 0 ? 0.78 : i === coords.length - 1 ? 0.62 : 1;
    const radius = width * 0.5 * taper;
    const nx = -dy * radius;
    const ny = dx * radius;
    left.push({ x: coords[i].x + nx, y: coords[i].y + ny });
    right.push({ x: coords[i].x - nx, y: coords[i].y - ny });
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i += 1) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i -= 1) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
}

export function ellipse(ctx, x, y, rx, ry, fill, stroke = null, width = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

export function roundedRect(ctx, x, y, width, height, radius, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

export function fabricOverlay(ctx, amount, bounds = { x: 315, y: 190, width: 130, height: 340 }) {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(0.42, amount * 0.34);
  const gradient = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
  gradient.addColorStop(0, '#6fb5c4');
  gradient.addColorStop(0.55, '#537f91');
  gradient.addColorStop(1, '#9ccbd0');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
