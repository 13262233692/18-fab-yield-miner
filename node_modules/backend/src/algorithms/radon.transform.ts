export interface RadonPeak {
  theta: number;
  rho: number;
  intensity: number;
  normalizedIntensity: number;
}

export interface RadonResult {
  sinogram: number[][];
  thetas: number[];
  rhos: number[];
  peaks: RadonPeak[];
}

export interface ScratchLine {
  id: string;
  theta: number;
  rho: number;
  intensity: number;
  a: number;
  b: number;
  c: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  defectCount: number;
  severity: 'CRITICAL' | 'WARNING' | 'MILD';
  angleDeg: number;
}

const DEG_TO_RAD = Math.PI / 180;

export function createSpatialMatrix(
  defects: Array<{ x: number; y: number; size: number }>,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  gridSize: number = 256,
): number[][] {
  const matrix: number[][] = Array.from({ length: gridSize }, () =>
    new Array(gridSize).fill(0)
  );

  const xRange = bounds.xMax - bounds.xMin;
  const yRange = bounds.yMax - bounds.yMin;

  if (xRange === 0 || yRange === 0) return matrix;

  const xScale = (gridSize - 1) / xRange;
  const yScale = (gridSize - 1) / yRange;

  defects.forEach((defect) => {
    const gx = Math.floor((defect.x - bounds.xMin) * xScale);
    const gy = Math.floor((defect.y - bounds.yMin) * yScale);

    if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
      const weight = 1 + (defect.size || 0) * 0.5;
      matrix[gy][gx] += weight;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
            matrix[ny][nx] += 0.3;
          }
        }
      }
    }
  });

  return matrix;
}

export function radonTransform(
  matrix: number[][],
  thetaStart: number = 0,
  thetaEnd: number = 180,
  thetaStep: number = 1,
): { sinogram: number[][]; thetas: number[]; rhos: number[] } {
  const H = matrix.length;
  const W = matrix[0].length;
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const maxRho = Math.sqrt(cx * cx + cy * cy);
  const nRho = Math.ceil(2 * maxRho) + 1;
  const rhoHalf = Math.floor(nRho / 2);

  const thetas: number[] = [];
  for (let t = thetaStart; t <= thetaEnd; t += thetaStep) {
    thetas.push(t * DEG_TO_RAD);
  }

  const nTheta = thetas.length;
  const sinogram: number[][] = Array.from({ length: nRho }, () =>
    new Array(nTheta).fill(0)
  );

  const rhos: number[] = [];
  for (let r = -rhoHalf; r <= rhoHalf; r++) {
    rhos.push(r);
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const val = matrix[y][x];
      if (val === 0) continue;

      const dx = x - cx;
      const dy = y - cy;

      for (let ti = 0; ti < nTheta; ti++) {
        const theta = thetas[ti];
        const rho = dx * Math.cos(theta) + dy * Math.sin(theta);
        const rhoIdx = Math.round(rho) + rhoHalf;

        if (rhoIdx >= 0 && rhoIdx < nRho) {
          sinogram[rhoIdx][ti] += val;

          if (rhoIdx > 0) {
            const frac = rho - (Math.round(rho));
            if (frac > 0 && rhoIdx + 1 < nRho) {
              sinogram[rhoIdx + 1][ti] += val * frac;
              sinogram[rhoIdx][ti] -= val * frac;
            } else if (frac < 0) {
              sinogram[rhoIdx - 1][ti] += val * (-frac);
              sinogram[rhoIdx][ti] -= val * (-frac);
            }
          }
        }
      }
    }
  }

  return { sinogram, thetas, rhos };
}

export function detectPeaks(
  sinogram: number[][],
  thetas: number[],
  rhos: number[],
  options: {
    thresholdPercentile?: number;
    minPeakDistanceTheta?: number;
    minPeakDistanceRho?: number;
    maxPeaks?: number;
  } = {},
): RadonPeak[] {
  const {
    thresholdPercentile = 99.5,
    minPeakDistanceTheta = 10,
    minPeakDistanceRho = 20,
    maxPeaks = 10,
  } = options;

  const nRho = sinogram.length;
  const nTheta = sinogram[0].length;

  const flatValues: number[] = [];
  for (let r = 0; r < nRho; r++) {
    for (let t = 0; t < nTheta; t++) {
      flatValues.push(sinogram[r][t]);
    }
  }
  flatValues.sort((a, b) => a - b);
  const thresholdIdx = Math.floor(flatValues.length * thresholdPercentile / 100);
  const threshold = flatValues[thresholdIdx];

  const maxVal = flatValues[flatValues.length - 1];

  const peakCandidates: Array<{
    rhoIdx: number;
    thetaIdx: number;
    intensity: number;
    theta: number;
    rho: number;
  }> = [];

  for (let r = 2; r < nRho - 2; r++) {
    for (let t = 2; t < nTheta - 2; t++) {
      const val = sinogram[r][t];
      if (val < threshold) continue;

      let isLocalMax = true;
      for (let dr = -2; dr <= 2 && isLocalMax; dr++) {
        for (let dt = -2; dt <= 2 && isLocalMax; dt++) {
          if (dr === 0 && dt === 0) continue;
          if (sinogram[r + dr][t + dt] > val) {
            isLocalMax = false;
          }
        }
      }

      if (isLocalMax) {
        peakCandidates.push({
          rhoIdx: r,
          thetaIdx: t,
          intensity: val,
          theta: thetas[t],
          rho: rhos[r],
        });
      }
    }
  }

  peakCandidates.sort((a, b) => b.intensity - a.intensity);

  const selectedPeaks: RadonPeak[] = [];
  const thetaStepDeg = (thetas[1] - thetas[0]) / DEG_TO_RAD;

  for (const candidate of peakCandidates) {
    if (selectedPeaks.length >= maxPeaks) break;

    const tooClose = selectedPeaks.some((peak) => {
      const thetaDiffDeg = Math.abs(
        (candidate.theta - peak.theta) / DEG_TO_RAD
      );
      const rhoDiff = Math.abs(candidate.rho - peak.rho);
      const thetaDist = Math.min(
        thetaDiffDeg,
        Math.abs(thetaDiffDeg - 180),
        Math.abs(thetaDiffDeg + 180)
      );
      return (
        thetaDist * thetaStepDeg < minPeakDistanceTheta &&
        rhoDiff < minPeakDistanceRho
      );
    });

    if (!tooClose) {
      selectedPeaks.push({
        theta: candidate.theta,
        rho: candidate.rho,
        intensity: candidate.intensity,
        normalizedIntensity: candidate.intensity / maxVal,
      });
    }
  }

  return selectedPeaks;
}

export function peakToLineEquation(
  peak: RadonPeak,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  gridSize: number = 256,
): {
  a: number;
  b: number;
  c: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
} {
  const theta = peak.theta;
  const xRange = bounds.xMax - bounds.xMin;
  const yRange = bounds.yMax - bounds.yMin;
  const scale = Math.max(xRange, yRange) / (gridSize - 1);
  const rho = peak.rho * scale;
  const cx = (bounds.xMin + bounds.xMax) / 2;
  const cy = (bounds.yMin + bounds.yMax) / 2;

  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const a = cosT;
  const b = sinT;
  const c = -(rho + cx * cosT + cy * sinT);

  const waferRadius = Math.max(xRange, yRange) / 2;
  const centerX = cx;
  const centerY = cy;
  const R = waferRadius * 1.1;

  if (Math.abs(sinT) < 0.001) {
    const xLine = -c / a;
    const sqrtTerm = R * R - (xLine - centerX) ** 2;
    if (sqrtTerm < 0) {
      return {
        a, b, c,
        startX: xLine - R, startY: centerY,
        endX: xLine + R, endY: centerY,
      };
    }
    const yOffset = Math.sqrt(sqrtTerm);
    return {
      a, b, c,
      startX: xLine, startY: centerY - yOffset,
      endX: xLine, endY: centerY + yOffset,
    };
  }

  if (Math.abs(cosT) < 0.001) {
    const yLine = -c / b;
    const sqrtTerm = R * R - (yLine - centerY) ** 2;
    if (sqrtTerm < 0) {
      return {
        a, b, c,
        startX: centerX, startY: yLine - R,
        endX: centerX, endY: yLine + R,
      };
    }
    const xOffset = Math.sqrt(sqrtTerm);
    return {
      a, b, c,
      startX: centerX - xOffset, startY: yLine,
      endX: centerX + xOffset, endY: yLine,
    };
  }

  const slope = -a / b;
  const intercept = -c / b;
  const dx0 = 1;
  const dy0 = slope;
  const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  const ux = dx0 / len0 * R;
  const uy = dy0 / len0 * R;

  let midX = centerX;
  let midY = slope * midX + intercept;

  const proj = (centerX * cosT + centerY * sinT + c);
  if (Math.abs(proj) > 0.001) {
    midX = centerX - cosT * proj;
    midY = centerY - sinT * proj;
  }

  return {
    a, b, c,
    startX: midX - ux,
    startY: midY - uy,
    endX: midX + ux,
    endY: midY + uy,
  };
}

export function countDefectsOnLine(
  defects: Array<{ x: number; y: number }>,
  line: { a: number; b: number; c: number },
  distanceThreshold: number = 2.0,
): number {
  const norm = Math.sqrt(line.a * line.a + line.b * line.b);
  if (norm === 0) return 0;

  let count = 0;
  for (const defect of defects) {
    const dist = Math.abs(line.a * defect.x + line.b * defect.y + line.c) / norm;
    if (dist <= distanceThreshold) {
      count++;
    }
  }
  return count;
}

export function classifySeverity(
  normalizedIntensity: number,
  defectCount: number,
  totalDefects: number,
): 'CRITICAL' | 'WARNING' | 'MILD' {
  const ratio = totalDefects > 0 ? defectCount / totalDefects : 0;

  if (normalizedIntensity > 0.7 || ratio > 0.05) {
    return 'CRITICAL';
  } else if (normalizedIntensity > 0.45 || ratio > 0.02) {
    return 'WARNING';
  }
  return 'MILD';
}

export function runFullRadonAnalysis(
  defects: Array<{ x: number; y: number; size: number }>,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  options: {
    gridSize?: number;
    thetaStep?: number;
  } = {},
): {
  lines: ScratchLine[];
  sinogram: number[][];
  thetas: number[];
  rhos: number[];
  peaks: RadonPeak[];
} {
  const { gridSize = 256, thetaStep = 1 } = options;

  const matrix = createSpatialMatrix(defects, bounds, gridSize);
  const { sinogram, thetas, rhos } = radonTransform(matrix, 0, 180, thetaStep);
  const peaks = detectPeaks(sinogram, thetas, rhos, {
    thresholdPercentile: 99.6,
    minPeakDistanceTheta: 15,
    minPeakDistanceRho: 25,
    maxPeaks: 8,
  });

  const lines: ScratchLine[] = peaks.map((peak, idx) => {
    const lineEq = peakToLineEquation(peak, bounds, gridSize);
    const defectCount = countDefectsOnLine(defects, lineEq, 2.5);
    const severity = classifySeverity(peak.normalizedIntensity, defectCount, defects.length);

    return {
      id: `scratch_${idx + 1}`,
      theta: peak.theta,
      rho: peak.rho,
      intensity: peak.intensity,
      a: lineEq.a,
      b: lineEq.b,
      c: lineEq.c,
      startX: lineEq.startX,
      startY: lineEq.startY,
      endX: lineEq.endX,
      endY: lineEq.endY,
      defectCount,
      severity,
      angleDeg: (peak.theta * 180) / Math.PI,
    };
  });

  return { lines, sinogram, thetas, rhos, peaks };
}
