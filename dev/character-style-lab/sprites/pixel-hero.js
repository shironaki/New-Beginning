const W = 64;
const H = 96;

// Hand-authored, game-sized clusters tuned to the selected olive / linen / leather look.
const P = {
  ink: '#272722', inkSoft: '#39332b', skin: '#d4946d', skinLight: '#efb38a', skinShade: '#9b604b',
  hair: '#33282b', hairMid: '#4d3635', hairLight: '#735047',
  coat: '#59684a', coatLight: '#788260', coatShade: '#3d4a39', coatEdge: '#303b31',
  shirt: '#dfd0ad', shirtLight: '#f1e4c5', shirtShade: '#b7a786',
  scarf: '#aaa69a', scarfLight: '#d0c9b7', scarfShade: '#77766f',
  trousers: '#41434a', trouserLight: '#66666a', trouserShade: '#302f35',
  leather: '#68452f', leatherLight: '#a17043', leatherShade: '#422f27',
  boot: '#573b30', bootLight: '#91634a', sole: '#292825',
  metal: '#9da69e', metalLight: '#e0dfcf', metalShade: '#59615e', brass: '#c39a57',
  flame: '#ed8a34', flameLight: '#ffd264', flameCore: '#fff0a0', glow: '#f5ac45',
  wet: '#80c6d0', wetLight: '#dbf1e8'
};

function rect(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function polygon(ctx, points, color, outline = null) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }
}

function segmentPoints(a, b, radius) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  const nx = -dy / length * radius;
  const ny = dx / length * radius;
  return [[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny]];
}

function limb(ctx, a, b, width, fill, highlight = null) {
  polygon(ctx, segmentPoints(a, b, width / 2 + 1), P.ink);
  polygon(ctx, segmentPoints(a, b, width / 2), fill);
  if (highlight) {
    const offset = { x: -1, y: 0 };
    polygon(ctx, segmentPoints({ x: a.x + offset.x, y: a.y + offset.y }, { x: b.x + offset.x, y: b.y + offset.y }, Math.max(0.8, width * 0.13)), highlight);
  }
}

function sideFor(role, direction) {
  const rightHand = role === 'right';
  if (direction === 'up') return rightHand ? 1 : -1;
  return rightHand ? -1 : 1;
}

function drawCloak(ctx, direction, phase) {
  if (direction === 'up') {
    polygon(ctx, [[20, 28], [25, 27], [39, 27], [44, 30], [49, 46], [46, 68], [41, 77], [23, 77], [18, 68], [15, 46]], P.coatEdge, P.ink);
    polygon(ctx, [[22, 31], [27, 30], [37, 30], [42, 33], [46, 48], [43, 66], [39, 73], [25, 73], [21, 66], [18, 48]], '#344438');
    polygon(ctx, [[23, 36], [31, 39], [40, 36], [44, 50], [41, 65], [37, 70], [27, 70], [23, 64]], '#405442');
    rect(ctx, 27, 70, 11, 1, '#798066');
    rect(ctx, 20, 48 + phase, 2, 12, '#4d614b');
    rect(ctx, 42, 50 - phase, 2, 12, '#303e36');
  } else {
    polygon(ctx, [[18, 30], [24, 28], [40, 28], [46, 31], [49, 52], [44, 74], [39, 78], [25, 78], [20, 74], [15, 52]], '#344438', P.ink);
    polygon(ctx, [[19, 34], [23, 31], [26, 35], [24, 57], [21, 70], [18, 68]], '#435744');
    polygon(ctx, [[43, 34], [47, 37], [48, 57], [44, 70], [41, 73], [40, 56]], '#40523f');
    rect(ctx, 20, 72, 6, 2, '#788064');
    rect(ctx, 39, 73, 7, 2, '#28392f');
  }
}

function drawPack(ctx, direction) {
  if (direction === 'up') {
    polygon(ctx, [[18, 31], [22, 27], [42, 27], [47, 32], [48, 56], [44, 62], [20, 62], [16, 56]], P.leatherShade, P.ink);
    polygon(ctx, [[20, 32], [24, 30], [40, 30], [44, 34], [45, 54], [41, 58], [23, 58], [19, 54]], P.leather, '#382d26');
    polygon(ctx, [[22, 33], [32, 31], [42, 34], [41, 41], [31, 43], [22, 40]], P.leatherLight, P.leatherShade);
    rect(ctx, 22, 45, 20, 2, P.leatherShade);
    rect(ctx, 25, 53, 14, 2, '#9a7048');
    rect(ctx, 30, 42, 5, 5, P.brass);
    rect(ctx, 31, 43, 3, 3, P.leatherShade);
    rect(ctx, 19, 35, 2, 17, '#b48758');
    rect(ctx, 43, 35, 2, 17, '#46352b');
  } else if (direction === 'left' || direction === 'right') {
    polygon(ctx, [[39, 32], [46, 34], [50, 40], [50, 54], [45, 59], [39, 56]], P.leatherShade, P.ink);
    polygon(ctx, [[41, 35], [46, 36], [48, 41], [48, 52], [44, 56], [41, 53]], P.leather, '#382d26');
    rect(ctx, 43, 39, 4, 2, P.leatherLight);
    rect(ctx, 43, 49, 4, 1, P.brass);
  } else {
    polygon(ctx, [[22, 30], [26, 28], [38, 28], [42, 31], [44, 44], [40, 48], [24, 48], [20, 44]], P.leatherShade, P.ink);
    rect(ctx, 23, 32, 3, 13, P.leather);
    rect(ctx, 38, 32, 3, 13, P.leather);
  }
}

function drawLeg(ctx, role, direction, motion, phase, bob) {
  const side = sideFor(role, direction);
  const lead = role === 'right' ? 1 : -1;
  const strideMax = motion === 'run' ? 4 : motion === 'walk' ? 2 : 0;
  const stride = Math.round(Math.sin(phase) * strideMax * lead);
  const lift = motion === 'idle' ? 0 : Math.max(0, Math.round(Math.cos(phase) * (motion === 'run' ? 3 : 1)));
  const hipX = 32 + side * 5;
  const x = hipX + stride;
  const y = bob - lift;
  const outer = [[x - 5, 55 + y], [x + 4, 55 + y], [x + 5, 64 + y], [x + 3, 73 + y], [x + 5, 80 + y], [x + 8, 83 + y], [x + 7, 88 + y], [x - 7, 88 + y], [x - 8, 84 + y], [x - 5, 78 + y], [x - 6, 69 + y]];
  polygon(ctx, outer, P.ink);
  if (role === 'left') rect(ctx, x - 1, 58 + y, 3, 6, '#dca278');
  polygon(ctx, [[x - 4, 56 + y], [x + 3, 56 + y], [x + 4, 64 + y], [x + 2, 72 + y], [x + 4, 79 + y], [x + 6, 82 + y], [x + 5, 86 + y], [x - 5, 86 + y], [x - 6, 83 + y], [x - 3, 77 + y], [x - 5, 69 + y]], P.skin);
  if (motion === 'run' && lift > 1) rect(ctx, x - 2, 72 + y, 3, 2, P.skinLight);
}

function drawTrousers(ctx, role, direction, motion, phase, bob) {
  const side = sideFor(role, direction);
  const lead = role === 'right' ? 1 : -1;
  const strideMax = motion === 'run' ? 4 : motion === 'walk' ? 2 : 0;
  const stride = Math.round(Math.sin(phase) * strideMax * lead);
  const lift = motion === 'idle' ? 0 : Math.max(0, Math.round(Math.cos(phase) * (motion === 'run' ? 3 : 1)));
  const x = 32 + side * 5 + stride;
  const y = bob - lift;
  polygon(ctx, [[x - 5, 54 + y], [x + 5, 54 + y], [x + 5, 63 + y], [x + 3, 72 + y], [x + 4, 79 + y], [x - 4, 79 + y], [x - 5, 72 + y], [x - 6, 63 + y]], P.trouserShade, P.ink);
  polygon(ctx, [[x - 4, 55 + y], [x + 3, 55 + y], [x + 4, 63 + y], [x + 2, 72 + y], [x + 3, 78 + y], [x - 3, 78 + y], [x - 4, 72 + y], [x - 5, 63 + y]], role === 'right' ? P.trousers : '#4b4c51');
  rect(ctx, x - 3, 62 + y, 2, 8, P.trouserLight);
  rect(ctx, x + 1, 71 + y, 3, 1, '#292a2e');
  rect(ctx, x - 3, 76 + y, 7, 1, P.leatherLight);
}

function drawBoot(ctx, role, direction, motion, phase, bob, equipped) {
  const side = sideFor(role, direction);
  const lead = role === 'right' ? 1 : -1;
  const stride = Math.round(Math.sin(phase) * (motion === 'run' ? 4 : motion === 'walk' ? 2 : 0) * lead);
  const lift = motion === 'idle' ? 0 : Math.max(0, Math.round(Math.cos(phase) * (motion === 'run' ? 3 : 1)));
  const x = 32 + side * 5 + stride;
  const y = bob - lift;
  const foot = [[x - 5, 77 + y], [x + 4, 77 + y], [x + 5, 82 + y], [x + 9, 84 + y], [x + 8, 88 + y], [x - 7, 88 + y], [x - 8, 85 + y]];
  if (!equipped) {
    polygon(ctx, foot, P.ink);
    polygon(ctx, [[x - 4, 78 + y], [x + 3, 78 + y], [x + 4, 83 + y], [x + 7, 85 + y], [x + 6, 87 + y], [x - 6, 87 + y], [x - 7, 84 + y]], P.skin);
    return;
  }
  polygon(ctx, foot, P.ink);
  polygon(ctx, [[x - 4, 78 + y], [x + 3, 78 + y], [x + 4, 82 + y], [x + 7, 84 + y], [x + 6, 86 + y], [x - 6, 86 + y], [x - 7, 84 + y]], P.boot);
  rect(ctx, x - 3, 79 + y, 2, 4, P.bootLight);
  rect(ctx, x + 1, 82 + y, 3, 1, P.leatherLight);
  rect(ctx, x - 7, 87 + y, 14, 2, P.sole);
}

function drawBaseTorso(ctx, direction, bob) {
  const back = direction === 'up';
  const y = bob;
  polygon(ctx, [[21, 31 + y], [27, 29 + y], [37, 29 + y], [43, 31 + y], [47, 38 + y], [45, 55 + y], [41, 61 + y], [23, 61 + y], [19, 55 + y], [17, 38 + y]], P.ink);
  polygon(ctx, [[22, 32 + y], [27, 31 + y], [37, 31 + y], [42, 32 + y], [45, 39 + y], [43, 54 + y], [40, 59 + y], [24, 59 + y], [21, 54 + y], [19, 39 + y]], P.skin);
  if (!back) {
    polygon(ctx, [[24, 33 + y], [31, 35 + y], [32, 39 + y], [29, 42 + y], [25, 41 + y]], P.skinLight);
    polygon(ctx, [[33, 35 + y], [40, 33 + y], [42, 39 + y], [39, 43 + y], [34, 41 + y]], P.skinLight);
    rect(ctx, 27, 48 + y, 10, 1, P.skinShade);
  } else {
    polygon(ctx, [[24, 34 + y], [31, 36 + y], [32, 40 + y], [29, 42 + y], [25, 41 + y]], P.skinShade);
    rect(ctx, 27, 45 + y, 10, 1, '#b57659');
  }
}

function drawShirt(ctx, direction, bob) {
  const back = direction === 'up';
  const y = bob;
  polygon(ctx, [[23, 33 + y], [28, 32 + y], [36, 32 + y], [41, 34 + y], [43, 54 + y], [40, 59 + y], [24, 59 + y], [21, 54 + y]], P.shirt, P.inkSoft);
  polygon(ctx, [[24, 35 + y], [29, 34 + y], [35, 34 + y], [39, 36 + y], [40, 53 + y], [38, 57 + y], [26, 57 + y], [24, 53 + y]], P.shirtLight);
  polygon(ctx, [[24, 35 + y], [29, 34 + y], [31, 37 + y], [29, 42 + y], [25, 40 + y]], P.shirtShade);
  polygon(ctx, [[40, 36 + y], [39, 42 + y], [35, 38 + y], [34, 35 + y]], '#c8b996');
  rect(ctx, 31, 39 + y, 2, 15, P.shirtShade);
  rect(ctx, 32, 39 + y, 1, 14, P.shirtLight);
  if (!back) {
    for (const by of [43, 47, 51]) rect(ctx, 32, by + y, 1, 1, P.leatherShade);
  } else {
    polygon(ctx, [[29, 34 + y], [35, 34 + y], [36, 54 + y], [32, 57 + y], [28, 54 + y]], '#d4c6a4');
    rect(ctx, 31, 38 + y, 2, 17, P.shirtShade);
    rect(ctx, 32, 38 + y, 1, 16, P.shirtLight);
  }
}

function drawCoat(ctx, direction, bob) {
  const back = direction === 'up';
  const y = bob;
  polygon(ctx, [[17, 32 + y], [22, 29 + y], [27, 30 + y], [31, 33 + y], [32, 39 + y], [29, 43 + y], [27, 58 + y], [22, 61 + y], [18, 57 + y], [15, 40 + y]], P.coatEdge, P.ink);
  polygon(ctx, [[47, 32 + y], [42, 29 + y], [37, 30 + y], [33, 33 + y], [32, 39 + y], [35, 43 + y], [37, 58 + y], [42, 61 + y], [46, 57 + y], [49, 40 + y]], P.coatEdge, P.ink);
  polygon(ctx, [[18, 33 + y], [23, 31 + y], [28, 33 + y], [30, 39 + y], [26, 43 + y], [25, 56 + y], [22, 59 + y], [19, 55 + y], [17, 40 + y]], P.coat);
  polygon(ctx, [[46, 33 + y], [41, 31 + y], [36, 33 + y], [34, 39 + y], [38, 43 + y], [39, 56 + y], [42, 59 + y], [45, 55 + y], [47, 40 + y]], P.coat);
  polygon(ctx, [[20, 35 + y], [22, 34 + y], [24, 43 + y], [22, 54 + y], [20, 51 + y]], P.coatLight);
  polygon(ctx, [[44, 35 + y], [42, 34 + y], [40, 43 + y], [42, 54 + y], [44, 51 + y]], P.coatShade);
  if (back) {
    polygon(ctx, [[26, 33 + y], [31, 34 + y], [32, 57 + y], [28, 58 + y], [25, 55 + y]], '#4b5942');
    polygon(ctx, [[38, 33 + y], [33, 34 + y], [32, 57 + y], [36, 58 + y], [39, 55 + y]], '#536247');
    rect(ctx, 31, 37 + y, 2, 20, '#83906b');
    rect(ctx, 31, 42 + y, 1, 2, P.leatherLight);
    rect(ctx, 22, 58 + y, 20, 2, '#303b31');
  } else {
    polygon(ctx, [[22, 32 + y], [28, 33 + y], [32, 39 + y], [29, 42 + y], [25, 38 + y]], P.coatLight, P.coatEdge);
    polygon(ctx, [[42, 32 + y], [36, 33 + y], [32, 39 + y], [35, 42 + y], [39, 38 + y]], '#657351', P.coatEdge);
    rect(ctx, 25, 42 + y, 2, 14, '#45533f');
    rect(ctx, 37, 43 + y, 2, 13, '#49563f');
    polygon(ctx, [[19, 47 + y], [25, 47 + y], [24, 54 + y], [19, 54 + y]], '#49573f', P.coatEdge);
    polygon(ctx, [[39, 47 + y], [45, 47 + y], [45, 54 + y], [40, 54 + y]], '#4a573f', P.coatEdge);
    rect(ctx, 20, 48 + y, 4, 1, '#97a078');
    rect(ctx, 40, 48 + y, 4, 1, '#8c946c');
    for (const by of [43, 48, 53]) rect(ctx, 37, by + y, 1, 1, P.brass);
  }
  rect(ctx, 18, 57 + y, 7, 2, P.coatShade);
  rect(ctx, 39, 57 + y, 7, 2, P.coatLight);
}

function drawShoulders(ctx, direction, bob) {
  const reverse = direction === 'up';
  const leftX = reverse ? 38 : 13;
  const rightX = reverse ? 13 : 38;
  for (const x of [leftX, rightX]) {
    polygon(ctx, [[x + 2, 32 + bob], [x + 7, 30 + bob], [x + 12, 32 + bob], [x + 13, 37 + bob], [x + 10, 40 + bob], [x + 3, 39 + bob], [x, 36 + bob]], P.ink);
    polygon(ctx, [[x + 3, 32 + bob], [x + 7, 31 + bob], [x + 11, 33 + bob], [x + 11, 36 + bob], [x + 9, 38 + bob], [x + 3, 37 + bob], [x + 1, 35 + bob]], P.coatLight);
    rect(ctx, x + 4, 33 + bob, 5, 1, '#9aa17a');
    rect(ctx, x + 3, 37 + bob, 6, 1, P.coatShade);
    rect(ctx, x + 8, 35 + bob, 2, 2, P.brass);
    rect(ctx, x + 8, 35 + bob, 1, 1, P.metalLight);
  }
}

function drawScarf(ctx, bob) {
  const y = bob;
  polygon(ctx, [[24, 22 + y], [28, 24 + y], [36, 24 + y], [40, 22 + y], [44, 26 + y], [42, 32 + y], [37, 35 + y], [26, 35 + y], [20, 32 + y], [19, 27 + y]], P.ink);
  polygon(ctx, [[24, 24 + y], [29, 25 + y], [35, 25 + y], [39, 24 + y], [42, 27 + y], [40, 31 + y], [36, 33 + y], [27, 33 + y], [22, 31 + y], [21, 27 + y]], P.scarfShade);
  polygon(ctx, [[25, 24 + y], [30, 26 + y], [36, 26 + y], [40, 24 + y], [41, 27 + y], [38, 29 + y], [26, 29 + y], [22, 27 + y]], P.scarfLight);
  rect(ctx, 25, 28 + y, 12, 1, P.scarf);
  rect(ctx, 27, 30 + y, 11, 1, '#c5bead');
  polygon(ctx, [[38, 29 + y], [43, 27 + y], [45, 30 + y], [44, 38 + y], [41, 41 + y], [38, 38 + y]], P.ink);
  polygon(ctx, [[39, 30 + y], [42, 29 + y], [43, 31 + y], [42, 37 + y], [40, 39 + y]], P.scarfShade);
  rect(ctx, 40, 31 + y, 1, 4, P.scarfLight);
}

function drawHead(ctx, direction, bob) {
  const back = direction === 'up';
  const profile = direction === 'left' || direction === 'right';
  const y = bob;
  polygon(ctx, [[24, 7 + y], [29, 4 + y], [37, 5 + y], [41, 10 + y], [42, 17 + y], [39, 23 + y], [34, 27 + y], [27, 26 + y], [22, 22 + y], [21, 14 + y]], P.ink);
  if (back) {
    polygon(ctx, [[24, 10 + y], [28, 7 + y], [36, 7 + y], [40, 11 + y], [40, 19 + y], [36, 24 + y], [28, 24 + y], [23, 20 + y]], P.hair);
    polygon(ctx, [[25, 9 + y], [31, 7 + y], [37, 9 + y], [38, 12 + y], [32, 13 + y], [26, 12 + y]], P.hairMid);
    rect(ctx, 26, 8 + y, 7, 1, P.hairLight);
    rect(ctx, 23, 15 + y, 2, 5, P.hairMid);
    rect(ctx, 38, 15 + y, 2, 5, P.hairMid);
    return;
  }
  polygon(ctx, [[25, 10 + y], [29, 8 + y], [36, 8 + y], [39, 12 + y], [39, 18 + y], [36, 23 + y], [32, 25 + y], [27, 23 + y], [24, 19 + y]], P.skin);
  polygon(ctx, [[26, 11 + y], [31, 9 + y], [35, 10 + y], [34, 12 + y], [28, 14 + y], [26, 17 + y]], P.skinLight);
  rect(ctx, 22, 15 + y, 3, 5, P.skinShade);
  rect(ctx, 39, 15 + y, 3, 5, P.skinShade);
  polygon(ctx, [[22, 15 + y], [19, 12 + y], [20, 8 + y], [24, 6 + y], [25, 4 + y], [31, 4 + y], [32, 6 + y], [37, 6 + y], [41, 10 + y], [43, 14 + y], [41, 17 + y], [38, 15 + y], [36, 11 + y], [32, 12 + y], [29, 16 + y], [25, 18 + y]], P.hair);
  polygon(ctx, [[21, 11 + y], [22, 8 + y], [26, 6 + y], [28, 7 + y], [26, 10 + y], [24, 14 + y], [22, 14 + y]], P.hairMid);
  polygon(ctx, [[29, 6 + y], [35, 6 + y], [39, 9 + y], [41, 13 + y], [38, 13 + y], [35, 10 + y], [31, 9 + y]], P.hairMid);
  rect(ctx, 25, 7 + y, 5, 1, P.hairLight);
  rect(ctx, 33, 7 + y, 4, 1, P.hairLight);
  if (profile) {
    rect(ctx, 27, 15 + y, 6, 2, P.ink);
    rect(ctx, 28, 16 + y, 2, 1, P.metalLight);
    polygon(ctx, [[38, 17 + y], [43, 19 + y], [40, 21 + y], [37, 20 + y]], P.skinLight);
    rect(ctx, 33, 22 + y, 5, 1, P.hairMid);
    return;
  }
  rect(ctx, 25, 15 + y, 5, 1, P.hair);
  rect(ctx, 35, 15 + y, 5, 1, P.hair);
  rect(ctx, 26, 16 + y, 4, 2, '#f0dfc7');
  rect(ctx, 35, 16 + y, 4, 2, '#f0dfc7');
  rect(ctx, 27, 16 + y, 2, 2, '#668e88');
  rect(ctx, 36, 16 + y, 2, 2, '#668e88');
  rect(ctx, 28, 17 + y, 1, 1, P.ink);
  rect(ctx, 37, 17 + y, 1, 1, P.ink);
  rect(ctx, 31, 18 + y, 2, 3, P.skinShade);
  rect(ctx, 29, 22 + y, 7, 1, P.hairMid);
}

function drawPackStraps(ctx, direction, bob) {
  if (direction === 'up') return;
  const y = bob;
  polygon(ctx, [[19, 31 + y], [22, 31 + y], [29, 54 + y], [26, 56 + y]], P.leatherShade);
  polygon(ctx, [[20, 32 + y], [21, 32 + y], [28, 53 + y], [27, 54 + y]], P.leatherLight);
  polygon(ctx, [[42, 31 + y], [45, 32 + y], [39, 54 + y], [36, 55 + y]], P.leatherShade);
  polygon(ctx, [[43, 32 + y], [44, 33 + y], [38, 53 + y], [37, 54 + y]], '#a97849');
  rect(ctx, 24, 42 + y, 5, 4, P.metalShade);
  rect(ctx, 25, 42 + y, 4, 3, P.metalLight);
  rect(ctx, 26, 43 + y, 2, 1, P.leatherShade);
  rect(ctx, 39, 39 + y, 2, 4, P.brass);
}

function drawArm(ctx, role, direction, state, phase, bob) {
  const side = sideFor(role, direction);
  const lead = role === state.leadHand ? 1.25 : 0.72;
  const sign = role === 'right' ? 1 : -1;
  const swing = state.motion === 'idle' ? 0 : Math.round(Math.sin(phase) * (state.motion === 'run' ? 4 : 2) * lead * sign);
  const shoulder = { x: 32 + side * 15, y: 35 + bob };
  const elbow = { x: 32 + side * 18, y: 47 + bob + Math.round(swing * 0.55) };
  const hand = { x: 32 + side * 17, y: 59 + bob + swing };
  const sleeve = state.garments.coat ? P.coat : state.garments.shirt ? P.shirt : P.skin;
  const sleeveLight = state.garments.coat ? P.coatLight : state.garments.shirt ? P.shirtLight : P.skinLight;
  limb(ctx, shoulder, elbow, 8.4, sleeve, sleeveLight);
  limb(ctx, elbow, hand, 6.6, sleeve, sleeveLight);
  if (state.garments.coat || state.garments.shirt) {
    rect(ctx, hand.x - 3, hand.y - 6, 6, 2, state.garments.coat ? P.coatShade : P.shirtShade);
    rect(ctx, hand.x - 2, hand.y - 6, 2, 1, sleeveLight);
  }
  return { ...hand, side };
}

function drawAxe(ctx, hand, time) {
  const bladeSide = hand.side < 0 ? -1 : 1;
  const sway = Math.round(Math.sin(time * 3.4) * 0.6);
  polygon(ctx, [[hand.x - 1, hand.y - 1], [hand.x + 2, hand.y - 1], [hand.x + 3, hand.y + 22 + sway], [hand.x, hand.y + 23 + sway]], P.leatherShade);
  polygon(ctx, [[hand.x, hand.y], [hand.x + 1, hand.y], [hand.x + 2, hand.y + 21 + sway], [hand.x + 1, hand.y + 21 + sway]], P.leatherLight);
  const ax = hand.x + bladeSide * 2;
  polygon(ctx, [[ax, hand.y + 18 + sway], [ax + bladeSide * 3, hand.y + 13 + sway], [ax + bladeSide * 10, hand.y + 12 + sway], [ax + bladeSide * 9, hand.y + 16 + sway], [ax + bladeSide * 5, hand.y + 21 + sway], [ax + bladeSide, hand.y + 21 + sway]], P.ink);
  polygon(ctx, [[ax + bladeSide, hand.y + 17 + sway], [ax + bladeSide * 4, hand.y + 14 + sway], [ax + bladeSide * 8, hand.y + 14 + sway], [ax + bladeSide * 7, hand.y + 17 + sway], [ax + bladeSide * 4, hand.y + 20 + sway], [ax + bladeSide, hand.y + 20 + sway]], P.metal);
  rect(ctx, ax + bladeSide * 5, hand.y + 15 + sway, 2, 2, P.metalLight);
  rect(ctx, hand.x - 2, hand.y + 2, 5, 1, P.brass);
}

function drawTorch(ctx, hand, time) {
  const flicker = Math.round(Math.sin(time * 13) * 1.2);
  polygon(ctx, [[hand.x - 1, hand.y - 18], [hand.x + 2, hand.y - 18], [hand.x + 3, hand.y + 2], [hand.x, hand.y + 3]], P.leatherShade);
  rect(ctx, hand.x, hand.y - 17, 1, 15, P.leatherLight);
  rect(ctx, hand.x - 3, hand.y - 18, 7, 2, P.leatherShade);
  rect(ctx, hand.x - 2, hand.y - 19, 5, 1, P.brass);
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = P.glow;
  ctx.beginPath(); ctx.ellipse(hand.x + 1, hand.y - 26, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  polygon(ctx, [[hand.x - 4, hand.y - 20], [hand.x - 5, hand.y - 24 - flicker], [hand.x - 2, hand.y - 31], [hand.x, hand.y - 27], [hand.x + 3, hand.y - 33 + flicker], [hand.x + 6, hand.y - 27], [hand.x + 5, hand.y - 21]], P.leatherShade);
  polygon(ctx, [[hand.x - 3, hand.y - 21], [hand.x - 4, hand.y - 24 - flicker], [hand.x - 1, hand.y - 30], [hand.x + 1, hand.y - 25], [hand.x + 3, hand.y - 31 + flicker], [hand.x + 5, hand.y - 26], [hand.x + 4, hand.y - 21]], P.flame);
  polygon(ctx, [[hand.x - 1, hand.y - 22], [hand.x, hand.y - 27], [hand.x + 2, hand.y - 30 + flicker], [hand.x + 4, hand.y - 25], [hand.x + 3, hand.y - 22]], P.flameLight);
  rect(ctx, hand.x + 1, hand.y - 25, 2, 3, P.flameCore);
}

function drawHand(ctx, hand, held) {
  polygon(ctx, [[hand.x - 3, hand.y - 2], [hand.x + 3, hand.y - 2], [hand.x + 4, hand.y + 2], [hand.x + 2, hand.y + 5], [hand.x - 2, hand.y + 4], [hand.x - 4, hand.y + 1]], P.ink);
  polygon(ctx, [[hand.x - 2, hand.y - 1], [hand.x + 2, hand.y - 1], [hand.x + 3, hand.y + 2], [hand.x + 1, hand.y + 4], [hand.x - 2, hand.y + 3], [hand.x - 3, hand.y + 1]], P.skinLight);
  rect(ctx, hand.x - 1, hand.y + 1, held ? 2 : 1, 2, P.skinShade);
  if (!held) {
    rect(ctx, hand.x + 2, hand.y + 2, 1, 2, P.skinLight);
    rect(ctx, hand.x - 2, hand.y + 2, 1, 2, P.skinLight);
  }
}

function drawWetFinish(ctx, state, bob) {
  if (state.wetness < 0.08) return;
  const alpha = Math.min(0.82, state.wetness);
  ctx.save();
  ctx.globalAlpha = alpha * 0.62;
  if (state.garments.coat) {
    rect(ctx, 20, 44 + bob, 1, 5, P.wet);
    rect(ctx, 42, 47 + bob, 1, 5, P.wet);
    rect(ctx, 24, 54 + bob, 1, 3, P.wetLight);
  }
  if (state.garments.shirt) {
    rect(ctx, 29, 45 + bob, 1, 4, P.wet);
    rect(ctx, 35, 49 + bob, 1, 3, P.wetLight);
  }
  if (state.garments.trousers) {
    rect(ctx, 26, 67 + bob, 1, 5, P.wet);
    rect(ctx, 37, 71 + bob, 1, 4, P.wetLight);
  }
  if (state.garments.cloak) {
    rect(ctx, 18, 58 + bob, 1, 7, P.wet);
    rect(ctx, 44, 61 + bob, 1, 6, P.wetLight);
  }
  ctx.restore();
}

function drawPixelArt(ctx, state, time) {
  const direction = state.direction ?? 'down';
  const back = direction === 'up';
  const profile = direction === 'left' || direction === 'right';
  const motion = state.motion ?? 'idle';
  const phase = time * (motion === 'run' ? 9.2 : motion === 'walk' ? 5.8 : 1.4);
  const bob = motion === 'run'
    ? Math.max(0, Math.round(Math.cos(phase) * 2))
    : motion === 'walk' ? Math.max(0, Math.round(Math.cos(phase) * 1)) : (Math.sin(time * 1.5) > 0.86 ? 1 : 0);

  ctx.save();
  if (profile) {
    ctx.translate(W / 2, 0); ctx.scale(0.78, 1); ctx.translate(-W / 2, 0);
  }
  if (direction === 'right') {
    ctx.translate(W, 0); ctx.scale(-1, 1);
  }

  // Ground contact and silhouette-moving layers.
  rect(ctx, 16, 91, 32, 1, '#273128');
  rect(ctx, 21, 92, 22, 1, '#202820');
  if (state.garments.cloak) drawCloak(ctx, direction, Math.round(Math.sin(phase) * 1));
  if (state.garments.pack && back) drawPack(ctx, direction);

  for (const role of ['right', 'left']) drawLeg(ctx, role, direction, motion, phase, bob);
  if (state.garments.trousers) {
    for (const role of ['right', 'left']) drawTrousers(ctx, role, direction, motion, phase, bob);
  }
  for (const role of ['right', 'left']) drawBoot(ctx, role, direction, motion, phase, bob, Boolean(state.garments.boots));

  drawBaseTorso(ctx, direction, bob);
  if (state.garments.shirt) drawShirt(ctx, direction, bob);
  if (state.garments.coat) drawCoat(ctx, direction, bob);
  if (state.garments.pack && !back) {
    drawPackStraps(ctx, direction, bob);
    if (profile) drawPack(ctx, direction);
    else {
      polygon(ctx, [[43, 43 + bob], [49, 44 + bob], [51, 53 + bob], [48, 59 + bob], [42, 58 + bob]], P.leatherShade, P.ink);
      polygon(ctx, [[44, 45 + bob], [48, 46 + bob], [49, 52 + bob], [47, 56 + bob], [44, 55 + bob]], P.leather);
      rect(ctx, 45, 48 + bob, 3, 1, P.leatherLight);
      rect(ctx, 45, 54 + bob, 3, 1, P.brass);
    }
  }
  drawHead(ctx, direction, bob);
  if (state.garments.scarf) drawScarf(ctx, bob);

  const hands = {};
  for (const role of ['right', 'left']) hands[role] = drawArm(ctx, role, direction, state, phase, bob);
  if (state.garments.coat) drawShoulders(ctx, direction, bob);

  // A weathered waist belt and small brass fastening echo the chosen reference.
  if (state.garments.coat || state.garments.trousers) {
    rect(ctx, 23, 58 + bob, 18, 2, P.leatherShade);
    rect(ctx, 26, 58 + bob, 12, 1, P.leatherLight);
    rect(ctx, 31, 57 + bob, 4, 4, P.metalShade);
    rect(ctx, 32, 58 + bob, 2, 2, P.brass);
  }

  drawWetFinish(ctx, state, bob);

  for (const role of ['right', 'left']) {
    const hand = hands[role];
    const item = state.items?.[role] ?? 'none';
    if (item === 'axe') drawAxe(ctx, hand, time);
    if (item === 'torch') drawTorch(ctx, hand, time);
    drawHand(ctx, hand, Boolean(item && item !== 'none'));
  }
  ctx.restore();
}

export function drawDetailedPixelCharacter(ctx, width, height, state, time = 0) {
  ctx.clearRect(0, 0, width, height);
  const scale = Math.max(1, Math.floor(Math.min(width / W, (height - 10) / H)));
  const x = Math.round((width - W * scale) / 2);
  const y = Math.round((height - H * scale) / 2 - scale * 2);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  drawPixelArt(ctx, state, time);
  ctx.restore();
}
