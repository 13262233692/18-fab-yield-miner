export interface DefectPoint {
  x: number;
  y: number;
  size?: number;
}

export interface ScratchLine {
  id: string;
  theta: number;
  rho: number;
  thetaDeg: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  lineEquation: {
    a: number;
    b: number;
    c: number;
  };
  a: number;
  b: number;
  c: number;
  intensity: number;
  defectCount: number;
  avgDefectSize: number;
  confidence: number;
  severity: string;
  lengthMm: number;
  waferId: string;
}

interface RadonResult {
  sinogram: number[][];
  thetaSteps: number;
  rhoSteps: number;
  thetaMin: number;
  thetaMax: number;
  rhoMin: number;
  rhoMax: number;
  dTheta: number;
  dRho: number;
}

export function pointsToGrid(
  points: DefectPoint[],
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  gridSize = 100,
): Float32Array {
  const grid = new Float32Array(gridSize * gridSize);
  const xStep = (bounds.xMax - bounds.xMin) / gridSize;
  const yStep = (bounds.yMax - bounds.yMin) / gridSize;

  for (const p of points) {
    const gx = Math.floor((p.x - bounds.xMin) / xStep);
    const gy = Math.floor((p.y - bounds.yMin) / yStep);
    if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
      const weight = p.size ? 1 + p.size * 0.3 : 1;
      grid[gy * gridSize + gx] += weight;
    }
  }

  return grid;
}

export function radonTransform(
  grid: Float32Array,
  gridSize: number,
  thetaSteps = 180,
): RadonResult {
  const thetaMin = 0;
  const thetaMax = Math.PI;
  const dTheta = (thetaMax - thetaMin) / thetaSteps;

  const center = gridSize / 2;
  const maxRho = Math.sqrt(2) * center;
  const rhoSteps = Math.ceil(maxRho * 2);
  const dRho = (2 * maxRho) / rhoSteps;
  const rhoMin = -maxRho;
  const rhoMax = maxRho;

  const sinogram: number[][] = new Array(thetaSteps);
  for (let i = 0; i < thetaSteps; i++) {
    sinogram[i] = new Array(rhoSteps).fill(0);
  }

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const val = grid[gy * gridSize + gx];
      if (val === 0) continue;

      const x = gx - center;
      const y = gy - center;

      for (let ti = 0; ti < thetaSteps; ti++) {
        const theta = ti * dTheta;
        const rho = x * Math.cos(theta) + y * Math.sin(theta);
        const rhoIdx = Math.floor((rho - rhoMin) / dRho);

        if (rhoIdx >= 0 && rhoIdx < rhoSteps) {
          sinogram[ti][rhoIdx] += val;
        }
      }
    }
  }

  return {
    sinogram,
    thetaSteps,
    rhoSteps,
    thetaMin,
    thetaMax,
    rhoMin,
    rhoMax,
    dTheta,
    dRho,
  };
}

export function findRadonPeaks(
  radon: RadonResult,
  threshold = 6,
  minPeakDistance = 8,
): Array<{ thetaIdx: number; rhoIdx: number; intensity: number }> {
  const { sinogram, thetaSteps, rhoSteps } = radon;

  const allValues: number[] = [];
  for (let t = 0; t < thetaSteps; t++) {
    for (let r = 0; r < rhoSteps; r++) {
      allValues.push(sinogram[t][r]);
    }
  }
  allValues.sort((a, b) => b - a);
  const mean = allValues.reduce((s, v) => s + v, 0) / allValues.length;
  const variance = allValues.reduce((s, v) => s + (v - mean) ** 2, 0) / allValues.length;
  const std = Math.sqrt(variance);
  const dynamicThreshold = Math.max(threshold, mean + 3.5 * std);

  const peaks: Array<{ thetaIdx: number; rhoIdx: number; intensity: number }> = [];

  for (let t = 2; t < thetaSteps - 2; t++) {
    for (let r = 2; r < rhoSteps - 2; r++) {
      const val = sinogram[t][r];
      if (val < dynamicThreshold) continue;

      let isLocalMax = true;
      for (let dt = -2; dt <= 2 && isLocalMax; dt++) {
        for (let dr = -2; dr <= 2; dr++) {
          if (dt === 0 && dr === 0) continue;
          if (sinogram[t + dt][r + dr] > val) {
            isLocalMax = false;
            break;
          }
        }
      }
      if (!isLocalMax) continue;

      let tooClose = false;
      for (const peak of peaks) {
        const dt = Math.abs(peak.thetaIdx - t);
        const dr = Math.abs(peak.rhoIdx - r);
        if (Math.sqrt(dt * dt + dr * dr) < minPeakDistance) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      peaks.push({ thetaIdx: t, rhoIdx: r, intensity: val });
    }
  }

  peaks.sort((a, b) => b.intensity - a.intensity);
  return peaks.slice(0, 10);
}

export function peakToScratchLine(
  peak: { thetaIdx: number; rhoIdx: number; intensity: number },
  radon: RadonResult,
  points: DefectPoint[],
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  waferId: string,
): ScratchLine {
  const theta = peak.thetaIdx * radon.dTheta + radon.thetaMin;
  const rho = peak.rhoIdx * radon.dRho + radon.rhoMin;

  const gridSize = 100;
  const center = gridSize / 2;
  const xScale = (bounds.xMax - bounds.xMin) / gridSize;
  const yScale = (bounds.yMax - bounds.yMin) / gridSize;
  const scale = Math.max(xScale, yScale);

  const rhoWorld = rho * scale;

  const a = Math.cos(theta);
  const b = Math.sin(theta);
  const c = -rhoWorld;

  const { xMin, xMax, yMin, yMax } = bounds;

  const intersections: Array<{ x: number; y: number }> = [];

  if (Math.abs(b) > 1e-6) {
    const y1 = (-c - a * xMin) / b;
    if (y1 >= yMin && y1 <= yMax) intersections.push({ x: xMin, y: y1 });

    const y2 = (-c - a * xMax) / b;
    if (y2 >= yMin && y2 <= yMax) intersections.push({ x: xMax, y: y2 });
  }

  if (Math.abs(a) > 1e-6) {
    const x3 = (-c - b * yMin) / a;
    if (x3 >= xMin && x3 <= xMax) intersections.push({ x: x3, y: yMin });

    const x4 = (-c - b * yMax) / a;
    if (x4 >= xMin && x4 <= xMax) intersections.push({ x: x4, y: yMax });
  }

  let startX = 0, startY = 0, endX = 0, endY = 0;
  if (intersections.length >= 2) {
    startX = intersections[0].x;
    startY = intersections[0].y;
    endX = intersections[1].x;
    endY = intersections[1].y;
  } else if (intersections.length === 1) {
    startX = intersections[0].x;
    startY = intersections[0].y;
    const dirX = -b;
    const dirY = a;
    const len = 200;
    endX = startX + dirX * len;
    endY = startY + dirY * len;
  }

  const perpDist = 1.5;
  const dirX = -b;
  const dirY = a;
  let defectCount = 0;
  let totalSize = 0;
  let minT = Infinity, maxT = -Infinity;
  const projPoints: Array<{ x: number; y: number; t: number }> = [];

  for (const p of points) {
    const dist = Math.abs(a * p.x + b * p.y + c) / Math.sqrt(a * a + b * b);
    if (dist <= perpDist) {
      defectCount++;
      totalSize += p.size || 1;
      const t = (p.x - startX) * dirX + (p.y - startY) * dirY;
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
      projPoints.push({ x: p.x, y: p.y, t });
    }
  }

  if (defectCount >= 3 && isFinite(minT) && isFinite(maxT)) {
    startX = startX + dirX * minT;
    startY = startY + dirY * minT;
    endX = startX + dirX * (maxT - minT);
    endY = startY + dirY * (maxT - minT);
  }

  const lengthMm = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
  const { sinogram, thetaSteps, rhoSteps } = radon;

  let localSum = 0, localCount = 0;
  const nh = 3;
  for (let dt = -nh; dt <= nh; dt++) {
    for (let dr = -nh; dr <= nh; dr++) {
      const ti = peak.thetaIdx + dt;
      const ri = peak.rhoIdx + dr;
      if (ti >= 0 && ti < thetaSteps && ri >= 0 && ri < rhoSteps) {
        localSum += sinogram[ti][ri];
        localCount++;
      }
    }
  }
  const localMean = localSum / localCount;
  const allMax = Math.max(...sinogram.flat());
  const confidence = Math.min(1, (peak.intensity / (localMean + 1)) * 0.3 + (peak.intensity / (allMax + 1)) * 0.7);
  const severity = confidence >= 0.8 ? 'CRITICAL' : confidence >= 0.6 ? 'WARNING' : 'MILD';

  return {
    id: `scratch_${waferId}_${peak.thetaIdx}_${peak.rhoIdx}`,
    theta,
    rho: rhoWorld,
    thetaDeg: (theta * 180) / Math.PI,
    startX,
    startY,
    endX,
    endY,
    lineEquation: { a, b, c },
    a, b, c,
    intensity: peak.intensity,
    defectCount,
    avgDefectSize: defectCount > 0 ? totalSize / defectCount : 0,
    confidence,
    severity,
    lengthMm,
    waferId,
  };
}

export function detectScratchLines(
  points: DefectPoint[],
  waferId: string,
  minDefects = 15,
  minConfidence = 0.5,
  minLengthMm = 5,
): ScratchLine[] {
  if (points.length < minDefects) return [];

  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  for (const p of points) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }

  const pad = 5;
  const bounds = {
    xMin: xMin - pad,
    xMax: xMax + pad,
    yMin: yMin - pad,
    yMax: yMax + pad,
  };

  const grid = pointsToGrid(points, bounds, 100);
  const radon = radonTransform(grid, 100, 180);
  const peaks = findRadonPeaks(radon, 4, 10);

  const lines: ScratchLine[] = [];
  for (const peak of peaks) {
    const line = peakToScratchLine(peak, radon, points, bounds, waferId);
    if (
      line.confidence >= minConfidence &&
      line.defectCount >= minDefects &&
      line.lengthMm >= minLengthMm
    ) {
      lines.push(line);
    }
  }

  return lines;
}
