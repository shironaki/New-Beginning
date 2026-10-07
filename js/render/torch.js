/** One time-driven flame profile for the sprite AND its light source. */
export function torchFlame(time = 0, wind = 0, movement = 0) {
    const beat = Math.sin(time * 10.7) * 0.6 + Math.sin(time * 17.3 + 1.2) * 0.4;
    const height = 7.5 + beat * 1.8;
    const lean = Math.sin(time * 7.4) * 1.1 + Math.max(-2, Math.min(2, wind)) * 1.4
        + Math.max(-1, Math.min(1, movement)) * 0.7;
    return { height, lean, width: 2.4 + Math.sin(time * 13.1) * 0.35,
        x: lean * 0.35, y: -12.6 - height * 0.38, intensity: 0.79 + beat * 0.07 };
}
export function paintTorchFlame(ctx, time = 0, wind = 0, movement = 0) {
    const f = torchFlame(time, wind, movement), base = -12.6;
    ctx.save();
    ctx.fillStyle = "#ed7a26";
    ctx.beginPath(); ctx.moveTo(-f.width, base);
    ctx.quadraticCurveTo(-f.width - 0.8 + f.lean * 0.4, base - f.height * 0.46, f.lean, base - f.height);
    ctx.quadraticCurveTo(f.lean * 0.1 + f.width * 0.35, base - f.height * 0.54, f.width, base);
    ctx.quadraticCurveTo(0, base + 1.8, -f.width, base); ctx.fill();
    ctx.fillStyle = "#ffd87c";
    ctx.beginPath(); ctx.moveTo(-f.width * 0.57, base);
    ctx.quadraticCurveTo(-1, base - f.height * 0.4, f.lean * 0.38, base - f.height * 0.72);
    ctx.quadraticCurveTo(f.width * 0.55, base - 2, f.width * 0.58, base);
    ctx.quadraticCurveTo(0, base + 1, -f.width * 0.57, base); ctx.fill();
    ctx.fillStyle = "#fff0b4";
    ctx.fillRect(-0.6, base - 1.8, 1.2, 1.8);
    // A bounded, rare ember, keyed to absolute time: no frame-rate RNG.
    const t = ((time % 2.3) + 2.3) % 2.3;
    if (t < 0.55) {
        ctx.globalAlpha *= 1 - t / 0.55;
        ctx.fillStyle = "#ffc164";
        ctx.fillRect(f.lean + wind * t * 3, base - f.height - 1 - t * 12, 0.65, 0.9);
    }
    ctx.restore();
}
