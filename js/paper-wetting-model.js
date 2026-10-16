/* 필터 종이 젖음 근사 모델.
   원뿔 모양 필터 종이를 (둘레 각도 × 높이) 격자로 펼쳐 놓고, 칸마다 얼마나 젖었는지와
   커피 색이 얼마나 배었는지를 계산합니다.

   - 원두 층과 고인 물에 닿은 부분은 빠르게 젖고, 커피 물이면 갈색으로 물듭니다.
   - 주전자 물줄기가 종이에 직접 닿으면 그 자리가 젖고, 물은 중력 때문에 아래로 흘러내립니다.
   - 젖은 곳의 물은 모세관 현상으로 옆과 위로 번지는데, 위로 번지는 속도는 훨씬 느립니다.
   화면 코드와 분리되어 있어 Node에서도 시험할 수 있습니다. */

(function definePaperWettingModel(globalScope) {
  const CONTACT_WETTING_RATE_PER_SECOND = 3;
  const CONTACT_STAIN_RATE_PER_SECOND = 0.6;
  const SIDEWAYS_WICKING_RATE_PER_SECOND = 0.5;
  const UPWARD_WICKING_RATE_PER_SECOND = 0.12;
  const DOWNWARD_WICKING_RATE_PER_SECOND = 0.5;
  /* 이보다 더 젖은 칸에서는 남는 물이 아래 칸으로 흘러내립니다 */
  const RUNOFF_WETNESS_THRESHOLD = 0.75;
  const RUNOFF_RATE_PER_SECOND = 8;
  /* 종이는 물이 마르면서 아주 천천히 밝아집니다 */
  const DRYING_RATE_PER_SECOND = 0.004;

  function createPaperWettingModel(options) {
    const angleSegments = options.angleSegments;
    const heightRows = options.heightRows;
    const paperHeight = options.paperHeight;
    const cellCount = angleSegments * heightRows;
    const rowHeight = paperHeight / (heightRows - 1);

    const wetness = new Float32Array(cellCount);
    const stain = new Float32Array(cellCount);
    const nextWetness = new Float32Array(cellCount);
    const nextStain = new Float32Array(cellCount);

    function indexOf(angleIndex, rowIndex) {
      const wrappedAngle = ((angleIndex % angleSegments) + angleSegments) % angleSegments;
      return rowIndex * angleSegments + wrappedAngle;
    }

    function rowAtHeight(height) {
      return Math.round(Math.min(paperHeight, Math.max(0, height)) / rowHeight);
    }

    /* contactHeights[각도]: 그 방향에서 원두 층이나 물이 종이에 닿아 있는 높이
       contactStains[각도]: 닿아 있는 물이 얼마나 진한 커피 물인지(0–1) */
    function applyContact(contactHeights, contactStains, stepSeconds) {
      for (let angleIndex = 0; angleIndex < angleSegments; angleIndex += 1) {
        const contactRow = rowAtHeight(contactHeights[angleIndex]);
        for (let rowIndex = 0; rowIndex <= contactRow && rowIndex < heightRows; rowIndex += 1) {
          const cellIndex = indexOf(angleIndex, rowIndex);
          wetness[cellIndex] += (1 - wetness[cellIndex]) * Math.min(1, CONTACT_WETTING_RATE_PER_SECOND * stepSeconds);
          stain[cellIndex] += (contactStains[angleIndex] - stain[cellIndex]) * Math.min(1, CONTACT_STAIN_RATE_PER_SECOND * stepSeconds) *
            (contactStains[angleIndex] > stain[cellIndex] ? 1 : 0.1);
        }
      }
    }

    /* 물줄기가 종이에 직접 닿은 자리를 적십니다. 깨끗한 물이라 커피 색은 묽어집니다 */
    function addDirectHit(angleRadians, height, amount) {
      const angleIndex = Math.round((angleRadians / (Math.PI * 2)) * angleSegments);
      const rowIndex = rowAtHeight(height);
      for (let angleOffset = -1; angleOffset <= 1; angleOffset += 1) {
        for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
          const row = rowIndex + rowOffset;
          if (row < 0 || row >= heightRows) {
            continue;
          }
          const cellIndex = indexOf(angleIndex + angleOffset, row);
          const weight = angleOffset === 0 && rowOffset === 0 ? 1 : 0.4;
          wetness[cellIndex] = Math.min(1.6, wetness[cellIndex] + amount * weight);
          stain[cellIndex] *= 1 - 0.05 * weight;
        }
      }
    }

    function spread(stepSeconds) {
      nextWetness.set(wetness);
      nextStain.set(stain);
      const sidewaysFraction = SIDEWAYS_WICKING_RATE_PER_SECOND * stepSeconds;
      const upwardFraction = UPWARD_WICKING_RATE_PER_SECOND * stepSeconds;
      const downwardFraction = DOWNWARD_WICKING_RATE_PER_SECOND * stepSeconds;
      const runoffFraction = RUNOFF_RATE_PER_SECOND * stepSeconds;

      for (let rowIndex = 0; rowIndex < heightRows; rowIndex += 1) {
        for (let angleIndex = 0; angleIndex < angleSegments; angleIndex += 1) {
          const cellIndex = indexOf(angleIndex, rowIndex);
          const ownWetness = wetness[cellIndex];
          if (ownWetness <= 0.001) {
            continue;
          }

          /* 옆으로 번짐 (양쪽 이웃이 같은 방식으로 주고받아 물의 양이 보존됩니다) */
          const rightIndex = indexOf(angleIndex + 1, rowIndex);
          const sidewaysFlow = (ownWetness - wetness[rightIndex]) * sidewaysFraction;
          nextWetness[cellIndex] -= sidewaysFlow;
          nextWetness[rightIndex] += sidewaysFlow;
          const sidewaysStainFlow = (stain[cellIndex] - stain[rightIndex]) * sidewaysFraction * 0.5;
          nextStain[cellIndex] -= sidewaysStainFlow;
          nextStain[rightIndex] += sidewaysStainFlow;

          if (rowIndex + 1 < heightRows) {
            /* 위로는 모세관 현상으로만 천천히 번집니다 */
            const upperIndex = indexOf(angleIndex, rowIndex + 1);
            const verticalDifference = ownWetness - wetness[upperIndex];
            let verticalFlow = verticalDifference * downwardFraction;
            if (verticalDifference > 0) {
              verticalFlow = verticalDifference * upwardFraction;
            }
            nextWetness[cellIndex] -= verticalFlow;
            nextWetness[upperIndex] += verticalFlow;
          }

          /* 너무 많이 젖은 칸의 물은 흘러내립니다. 커피 색도 함께 끌려 내려갑니다 */
          if (rowIndex > 0 && ownWetness > RUNOFF_WETNESS_THRESHOLD) {
            const lowerIndex = indexOf(angleIndex, rowIndex - 1);
            const runoff = (ownWetness - RUNOFF_WETNESS_THRESHOLD) * runoffFraction;
            nextWetness[cellIndex] -= runoff;
            nextWetness[lowerIndex] += runoff;
            nextStain[lowerIndex] += (stain[cellIndex] - stain[lowerIndex]) * Math.min(1, runoff);
          }
        }
      }

      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        wetness[cellIndex] = Math.max(0, nextWetness[cellIndex] - DRYING_RATE_PER_SECOND * stepSeconds);
        stain[cellIndex] = Math.min(1, Math.max(0, nextStain[cellIndex]));
      }
    }

    function step(stepSeconds, contactHeights, contactStains) {
      applyContact(contactHeights, contactStains, stepSeconds);
      spread(stepSeconds);
    }

    function reset() {
      wetness.fill(0);
      stain.fill(0);
    }

    /* 화면에 그릴 때 쓰는 0–1 사이 젖음 값 */
    function readWetness(angleIndex, rowIndex) {
      return Math.min(1, wetness[indexOf(angleIndex, rowIndex)]);
    }

    function readStain(angleIndex, rowIndex) {
      return stain[indexOf(angleIndex, rowIndex)];
    }

    return {
      angleSegments: angleSegments,
      heightRows: heightRows,
      rowHeight: rowHeight,
      step: step,
      addDirectHit: addDirectHit,
      reset: reset,
      readWetness: readWetness,
      readStain: readStain
    };
  }

  const PaperWettingModel = { createPaperWettingModel: createPaperWettingModel };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PaperWettingModel;
  } else {
    globalScope.CoffeeSession = globalScope.CoffeeSession || {};
    globalScope.CoffeeSession.PaperWettingModel = PaperWettingModel;
  }
})(typeof window !== "undefined" ? window : globalThis);
