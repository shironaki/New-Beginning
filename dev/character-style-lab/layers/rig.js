const RIGHT_SIDE = { down: -1, up: 1, left: -1, right: -1 };

function carryPose(item, motion) {
  if (item === 'torch') return motion === 'idle' ? -40 : motion === 'walk' ? -30 : -18;
  if (item === 'axe') return motion === 'idle' ? 12 : motion === 'walk' ? 5 : -4;
  return 0;
}

export function buildPose({ direction = 'down', motion = 'idle', time = 0, leadHand = 'right', items = {} } = {}) {
  const isSide = direction === 'left' || direction === 'right';
  const isBack = direction === 'up';
  const frequency = motion === 'run' ? 10.5 : motion === 'walk' ? 7 : 1.35;
  const amplitude = motion === 'run' ? 23 : motion === 'walk' ? 14 : 2.5;
  const step = motion === 'idle' ? Math.sin(time * frequency) * 0.55 : Math.sin(time * frequency);
  const bob = motion === 'run'
    ? Math.abs(Math.sin(time * frequency)) * 5
    : motion === 'walk' ? Math.abs(Math.sin(time * frequency)) * 2.4 : Math.sin(time * frequency) * 1.3;
  const rightSide = RIGHT_SIDE[direction] ?? -1;
  const hands = {};
  const arms = [];
  const legs = [];

  for (const role of ['right', 'left']) {
    const side = role === 'right' ? rightSide : -rightSide;
    const leadFactor = role === leadHand ? 1.18 : 0.88;
    const swing = step * amplitude * leadFactor * (role === 'right' ? 1 : -1);
    const item = items[role] ?? 'none';
    const carry = carryPose(item, motion);
    const inwardBend = item === 'torch' ? -side * 7 : item === 'axe' ? side * 2 : 0;
    const shoulder = { x: 380 + side * (isSide ? 30 : 43), y: 218 };
    const elbow = {
      x: 380 + side * (isSide ? 39 : 65) - swing * 0.22 + inwardBend,
      y: 279 + carry * 0.55 + swing * 0.52
    };
    const wrist = {
      x: 380 + side * (isSide ? 45 : 69) - swing * 0.38 + (item === 'torch' ? side * 6 : 0),
      y: 323 + carry + swing * 0.78
    };
    if (item === 'torch') {
      elbow.x = 380 + side * (isSide ? 41 : 63) - swing * 0.2;
      elbow.y = 301 + carry * 0.18 + swing * 0.3;
    }
    arms.push({ role, side, shoulder, elbow, wrist, swing });
    hands[role] = { x: wrist.x, y: wrist.y, angle: swing * 0.007, side };

    const stride = step * (motion === 'idle' ? 1.4 : amplitude * 0.78) * (role === 'right' ? 1 : -1);
    const hip = { x: 380 + side * (isSide ? 12 : 21), y: 342 };
    const knee = { x: 380 + side * (isSide ? 19 : 27) + stride, y: 417 + Math.abs(step) * (motion === 'run' ? 4 : 1.5) };
    const ankle = { x: 380 + side * (isSide ? 14 : 22) + stride * 1.22, y: 493 - Math.max(0, -step * stride) * (motion === 'run' ? 0.14 : 0.08) };
    legs.push({ role, side, hip, knee, ankle, stride });
  }

  return {
    direction, motion, leadHand, isSide, isBack, mirror: direction === 'right', bob,
    phase: time * frequency, arms, legs, hands
  };
}
