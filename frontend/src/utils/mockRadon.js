const WAFER_RADIUS_MM = 150;
const DEG_TO_RAD = Math.PI / 180;

export function runMockRadonAnalysis(defects, waferId) {
  const seed = waferId ? waferId.charCodeAt(waferId.length - 1) : 5;
  const rand = mulberry32(seed * 9301 + 49297);

  const hasCritical = waferId && (
    waferId.endsWith('03') || waferId.endsWith('05') || waferId.endsWith('07')
  );
  const hasWarning = waferId && (
    waferId.endsWith('02') || waferId.endsWith('04') || waferId.endsWith('08')
  );

  const scratchLines = [];
  let severityCount = { CRITICAL: 0, WARNING: 0, MILD: 0 };

  if (hasCritical) {
    const criticalCount = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < criticalCount; i++) {
      const line = generateScratchLine(rand, 'CRITICAL', i);
      scratchLines.push(line);
      severityCount.CRITICAL++;
    }
  }

  if (hasWarning) {
    const warningCount = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < warningCount; i++) {
      const line = generateScratchLine(rand, 'WARNING', i + 10);
      scratchLines.push(line);
      severityCount.WARNING++;
    }
  }

  if (!hasCritical && !hasWarning && rand() > 0.5) {
    const line = generateScratchLine(rand, 'MILD', 20);
    scratchLines.push(line);
    severityCount.MILD++;
  }

  scratchLines.forEach((line) => {
    line.defectCount = countDefectsNearLine(defects || [], line, 2.5);
  });

  return {
    scratchLines,
    severityCount,
    totalDefects: (defects || []).length,
    analysisDurationMs: Math.floor(300 + rand() * 800),
    gridSize: 256,
    thetaStep: 1,
  };
}

function generateScratchLine(rand, severity, idx) {
  const angleDeg = severity === 'CRITICAL'
    ? (rand() * 60 - 30)
    : severity === 'WARNING'
      ? (rand() * 90 - 45)
      : (rand() * 180);

  const angleRad = angleDeg * DEG_TO_RAD;
  const cosT = Math.cos(angleRad);
  const sinT = Math.sin(angleRad);

  const offsetRange = severity === 'CRITICAL' ? 60 : severity === 'WARNING' ? 90 : 120;
  const rho = (rand() - 0.5) * 2 * offsetRange;

  const a = cosT;
  const b = sinT;
  const c = -rho;

  const R = WAFER_RADIUS_MM * 1.05;
  const tValues = [];

  if (Math.abs(sinT) < 0.001) {
    const xLine = -c / a;
    const sqrtTerm = R * R - xLine * xLine;
    if (sqrtTerm >= 0) {
      const yOff = Math.sqrt(sqrtTerm);
      tValues.push({ x: xLine, y: -yOff });
      tValues.push({ x: xLine, y: yOff });
    } else {
      tValues.push({ x: xLine - R, y: 0 });
      tValues.push({ x: xLine + R, y: 0 });
    }
  } else if (Math.abs(cosT) < 0.001) {
    const yLine = -c / b;
    const sqrtTerm = R * R - yLine * yLine;
    if (sqrtTerm >= 0) {
      const xOff = Math.sqrt(sqrtTerm);
      tValues.push({ x: -xOff, y: yLine });
      tValues.push({ x: xOff, y: yLine });
    } else {
      tValues.push({ x: 0, y: yLine - R });
      tValues.push({ x: 0, y: yLine + R });
    }
  } else {
    const slope = -a / b;
    const intercept = -c / b;

    const A = 1 + slope * slope;
    const B = 2 * slope * intercept;
    const C = intercept * intercept - R * R;
    const disc = B * B - 4 * A * C;

    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const x1 = (-B - sq) / (2 * A);
      const x2 = (-B + sq) / (2 * A);
      tValues.push({ x: x1, y: slope * x1 + intercept });
      tValues.push({ x: x2, y: slope * x2 + intercept });
    } else {
      const dx0 = 1;
      const dy0 = slope;
      const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      const ux = dx0 / len0 * R;
      const uy = dy0 / len0 * R;

      const projLen = (0 * cosT + 0 * sinT + c);
      const midX = 0 - cosT * projLen;
      const midY = 0 - sinT * projLen;

      tValues.push({ x: midX - ux, y: midY - uy });
      tValues.push({ x: midX + ux, y: midY + uy });
    }
  }

  if (tValues.length < 2) {
    const dx0 = 1;
    const dy0 = -a / b;
    const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
    const ux = dx0 / len0 * R;
    const uy = dy0 / len0 * R;
    const projLen = c;
    const midX = -cosT * projLen;
    const midY = -sinT * projLen;
    tValues.push({ x: midX - ux, y: midY - uy });
    tValues.push({ x: midX + ux, y: midY + uy });
  }

  return {
    id: `scratch_${idx + 1}`,
    theta: angleRad,
    rho: rho,
    intensity: severity === 'CRITICAL'
      ? (0.8 + rand() * 0.2) * 1000
      : severity === 'WARNING'
        ? (0.5 + rand() * 0.3) * 800
        : (0.3 + rand() * 0.2) * 500,
    a: a,
    b: b,
    c: c,
    lineEquation: { a, b, c },
    startX: tValues[0].x,
    startY: tValues[0].y,
    endX: tValues[1].x,
    endY: tValues[1].y,
    defectCount: 0,
    severity: severity,
    confidence: severity === 'CRITICAL' ? 0.85 + rand() * 0.15 : severity === 'WARNING' ? 0.6 + rand() * 0.2 : 0.45 + rand() * 0.15,
    angleDeg: angleDeg,
    lengthMm: Math.sqrt((tValues[1].x - tValues[0].x) ** 2 + (tValues[1].y - tValues[0].y) ** 2),
  };
}

function countDefectsNearLine(defects, line, threshold) {
  const norm = Math.sqrt(line.a * line.a + line.b * line.b);
  if (norm === 0) return 0;

  let count = 0;
  for (const d of defects) {
    const dist = Math.abs(line.a * d.x + line.b * d.y + line.c) / norm;
    if (dist <= threshold) count++;
  }
  return count;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getSeverityColor(severity) {
  switch (severity) {
    case 'CRITICAL':
      return { line: '#ff1744', glow: 'rgba(255, 23, 68, 0.6)', fill: 'rgba(255, 23, 68, 0.9)' };
    case 'WARNING':
      return { line: '#ff9100', glow: 'rgba(255, 145, 0, 0.5)', fill: 'rgba(255, 145, 0, 0.85)' };
    case 'MILD':
      return { line: '#ffc400', glow: 'rgba(255, 196, 0, 0.4)', fill: 'rgba(255, 196, 0, 0.75)' };
    default:
      return { line: '#888888', glow: 'rgba(136, 136, 136, 0.3)', fill: 'rgba(136, 136, 136, 0.7)' };
  }
}
