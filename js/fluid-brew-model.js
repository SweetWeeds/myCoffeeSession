/* 드립 추출 유체 근사 모델.
   드리퍼 안의 원두 층을 위에서 내려다본 격자로 나누고, 칸마다 원두 양, 고인 물 높이,
   머금은 물, 남은 가스, 녹아 나온 성분을 따로 계산합니다.

   - 물의 퍼짐: 이웃 칸과의 수면 높이 차이로 물이 흐르는 얕은 물 모델(가상 파이프 방식)을 씁니다.
     그래서 원두 층이 울퉁불퉁하면 낮은 곳으로 물이 몰리고, 붓는 위치에 따라 물결이 생깁니다.
   - 번짐: 젖은 원두의 물은 모세관 현상처럼 옆의 마른 원두로 천천히 번집니다.
   - 침투: 물을 머금은 칸에서만 아래로 물이 빠지며, 원두 층이 얇은 곳일수록 빨리 빠집니다(물길).
     빠지는 물이 원두를 지나면서 성분을 녹여 냅니다.
   - 뜸: 갓 젖은 원두는 가스를 내뿜으며 부풀고, 가스가 남아 있는 동안은 물이 잘 스며들지 않습니다.
   - 필터 벽: 가장자리에 고인 물이나 필터 종이에 직접 부은 물은 원두를 거치지 않고 흘러내립니다.

   순서를 강제하지 않습니다. 원두 없이 물을 붓거나, 물을 부은 뒤 가루를 더 넣어도 계산이 이어집니다.
   정확한 물리 시뮬레이션이 아니라, 드립에서 체감하는 경향을 재현하도록 상수를 맞춘 근사 모델입니다.
   화면 코드와 분리되어 있어 Node에서도 불러서 시험할 수 있습니다. */

(function defineFluidBrewModel(globalScope) {
  /* ---------- 격자와 크기 ---------- */
  const GRID_SIZE = 41;
  const BED_SURFACE_AREA_SQUARE_CENTIMETERS = 30;
  /* 가장자리 몇 칸은 필터 벽에 닿아 있는 칸으로 봅니다 */
  const WALL_ZONE_RADIUS = 0.86;
  const BULK_DENSITY_GRAMS_PER_CUBIC_CENTIMETER = 0.4;
  /* 상수를 맞출 때 기준으로 삼은 원두 양. 이 양을 평평하게 담았을 때의 두께가 기준 두께입니다 */
  const REFERENCE_DOSE_GRAMS = 15;

  /* ---------- 물 흐름 ---------- */
  /* 실제 중력보다 작게 잡아 계산을 안정시키고 물결이 눈에 보이도록 했습니다 */
  const EFFECTIVE_GRAVITY = 2000;
  const FLUX_DAMPING_PER_STEP = 0.985;
  const MAXIMUM_STEP_SECONDS = 1 / 200;

  /* ---------- 흡수와 뜸 ---------- */
  const WATER_RETAINED_PER_GRAM_OF_COFFEE = 2;
  const ABSORPTION_RATE_PER_GRAM_OF_COFFEE = 1.5;
  const BLOOM_GAS_RELEASE_SECONDS = 18;
  const BLOOM_RISE_MILLIMETERS = 4;
  /* 젖은 원두에서 옆의 마른 원두로 물이 번지는 속도(모세관 현상) */
  const WICKING_RATE_PER_SECOND = 0.6;
  /* 가스가 가득할 때 물이 스미는 속도와 추출 속도가 얼마나 줄어드는지 */
  const GAS_RESISTANCE = 0.6;

  /* ---------- 침투와 우회 ---------- */
  const PERMEABILITY_GRAMS_PER_SECOND_PER_MILLIMETER = 7.3e-5;
  const PERCOLATION_HEAD_OFFSET_MILLIMETERS = 5;
  const MINIMUM_THICKNESS_FACTOR = 0.5;
  const MAXIMUM_THICKNESS_FACTOR = 2;
  /* 이보다 얇은 곳은 원두가 거의 없는 것으로 보고, 물이 필터로 바로 빠집니다 */
  const BARE_PAPER_THICKNESS_MILLIMETERS = 0.3;
  const BARE_PAPER_DRAIN_RATE_PER_SECOND = 2;
  const WALL_BYPASS_RATE_PER_SECOND = 0.03;
  const NEUTRAL_FINES_FRACTION = 0.1;

  /* ---------- 추출 ---------- */
  const MAXIMUM_EXTRACTABLE_FRACTION = 0.3;
  const BASE_EXTRACTION_RATE = 0.021;
  const IMMERSION_CONTACT_WEIGHT = 0.35;
  const FLOW_CONTACT_WEIGHT = 2.6;
  const FULL_IMMERSION_DEPTH_MILLIMETERS = 5;
  const NEUTRAL_TEMPERATURE_CELSIUS = 92;
  const TEMPERATURE_SENSITIVITY = 0.04;
  const NEUTRAL_GRIND_SETTING = 5.5;
  const GRIND_SENSITIVITY = 0.6;

  /* ---------- 원두 쌓기 ---------- */
  const GROUNDS_SPREAD_RADIUS = 0.65;
  const CONE_SLIDE_FACTOR = 0.45;
  /* 원두 가루가 버틸 수 있는 최대 경사(칸 사이 높이 차, mm). 넘으면 아래로 흘러내립니다 */
  const RESTING_SLOPE_MILLIMETERS = 0.35;
  const SHAKE_SLOPE_MILLIMETERS = 0.15;
  const SHAKE_LEVELING_FRACTION = 0.12;

  /* ---------- 붓기 ---------- */
  const POUR_SPLASH_RADIUS = 0.07;
  const POUR_MERGE_GAP_SECONDS = 1.5;
  const MINIMUM_BLOOM_WAIT_SECONDS = 20;
  const EMPTY_WATER_THRESHOLD_GRAMS = 0.3;
  const MINIMUM_COFFEE_FOR_RESULT_GRAMS = 0.5;

  /* ---------- 맛 판정 ---------- */
  const IDEAL_EXTRACTION_LOW = 18;
  const IDEAL_EXTRACTION_HIGH = 22;
  const IDEAL_STRENGTH_LOW = 1.2;
  const IDEAL_STRENGTH_HIGH = 1.55;

  const POUR_RATES_GRAMS_PER_SECOND = {
    gentle: 4,
    normal: 6,
    strong: 9
  };

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  /* 분쇄가 굵을수록 물이 빨리 빠집니다 (1: 아주 가늘게, 10: 아주 굵게) */
  function calculateGrindPermeability(grindSetting) {
    return (0.6 + 0.36 * grindSetting) / 2.4;
  }

  function createBrewModel(settings) {
    const cellCount = GRID_SIZE * GRID_SIZE;
    const isActive = new Uint8Array(cellCount);
    const isWallCell = new Uint8Array(cellCount);

    let activeCellCount = 0;
    for (let row = 0; row < GRID_SIZE; row += 1) {
      for (let column = 0; column < GRID_SIZE; column += 1) {
        const cellIndex = row * GRID_SIZE + column;
        const normalizedX = (column / (GRID_SIZE - 1)) * 2 - 1;
        const normalizedY = (row / (GRID_SIZE - 1)) * 2 - 1;
        const radius = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
        if (radius <= 1) {
          isActive[cellIndex] = 1;
          activeCellCount += 1;
          if (radius > WALL_ZONE_RADIUS) {
            isWallCell[cellIndex] = 1;
          }
        }
      }
    }

    const cellAreaSquareCentimeters = BED_SURFACE_AREA_SQUARE_CENTIMETERS / activeCellCount;
    const millimetersPerGram = 10 / cellAreaSquareCentimeters;
    const gramsPerMillimeter = 1 / millimetersPerGram;
    const cellSideMillimeters = Math.sqrt(cellAreaSquareCentimeters) * 10;
    const bedMillimetersPerGram = millimetersPerGram / BULK_DENSITY_GRAMS_PER_CUBIC_CENTIMETER;
    const referenceBedMillimeters = (REFERENCE_DOSE_GRAMS / activeCellCount) * bedMillimetersPerGram;

    const coffeeGrams = new Float32Array(cellCount);
    const waterMillimeters = new Float32Array(cellCount);
    const absorbedGrams = new Float32Array(cellCount);
    const gasRemaining = new Float32Array(cellCount);
    const extractedGrams = new Float32Array(cellCount);
    const surfaceHeight = new Float32Array(cellCount);
    const fluxRight = new Float32Array(cellCount);
    const fluxLeft = new Float32Array(cellCount);
    const fluxDown = new Float32Array(cellCount);
    const fluxUp = new Float32Array(cellCount);
    const drainRateGramsPerSecond = new Float32Array(cellCount);
    const depositWeights = new Float32Array(cellCount);
    gasRemaining.fill(1);

    let finesFraction = NEUTRAL_FINES_FRACTION;
    let permeability = 0;
    let extractionRate = 0;

    /* 고운 가루(미분) 비율은 원두를 다 간 뒤에야 알 수 있어서, 나중에 다시 정할 수 있게 해 둡니다 */
    function setFinesFraction(newFinesFraction) {
      finesFraction = newFinesFraction;
      permeability =
        PERMEABILITY_GRAMS_PER_SECOND_PER_MILLIMETER *
        calculateGrindPermeability(settings.grindSetting) *
        (1 - finesFraction) / (1 - NEUTRAL_FINES_FRACTION);
      extractionRate =
        BASE_EXTRACTION_RATE *
        Math.exp((settings.temperatureCelsius - NEUTRAL_TEMPERATURE_CELSIUS) * TEMPERATURE_SENSITIVITY) *
        Math.pow(NEUTRAL_GRIND_SETTING / settings.grindSetting, GRIND_SENSITIVITY) *
        (1 + (finesFraction - NEUTRAL_FINES_FRACTION) * 0.8) *
        (1 + (settings.beanExtractionOffset || 0) * 0.12);
    }

    if (settings.finesFraction === undefined) {
      setFinesFraction(NEUTRAL_FINES_FRACTION);
    } else {
      setFinesFraction(settings.finesFraction);
    }

    const state = {
      phase: "idle",
      elapsedSeconds: 0,
      groundsDepositedGrams: 0,
      totalPouredGrams: 0,
      wallPouredGrams: 0,
      bypassGrams: 0,
      percolatedTotalGrams: 0,
      beverageGrams: 0,
      waterOnBedGrams: 0,
      isPouring: false,
      pourX: 0,
      pourY: 0,
      drawdownCompleteSecond: null,
      pourSegments: [],
      initialBedUnevenness: null,
      groundsAtFirstPourGrams: null,
      spilledGrams: 0
    };

    const targetWaterGrams = settings.doseGrams * settings.ratio;

    /* ---------- 원두 쌓기 ---------- */

    function cellCenterX(cellIndex) {
      return ((cellIndex % GRID_SIZE) / (GRID_SIZE - 1)) * 2 - 1;
    }

    function cellCenterY(cellIndex) {
      return (Math.floor(cellIndex / GRID_SIZE) / (GRID_SIZE - 1)) * 2 - 1;
    }

    /* 가루를 (x, y) 근처에 종 모양으로 쌓습니다. 원뿔 드리퍼라서 가루는 붓는 위치보다 가운데 쪽으로 미끄러져 모입니다 */
    function depositGrounds(normalizedX, normalizedY, grams) {
      if (grams <= 0 || state.phase === "finished") {
        return 0;
      }
      const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
      const slideDistance = Math.min(distance, 1) * CONE_SLIDE_FACTOR;
      let centerX = 0;
      let centerY = 0;
      if (distance > 1e-6) {
        centerX = (normalizedX / distance) * slideDistance;
        centerY = (normalizedY / distance) * slideDistance;
      }

      let weightSum = 0;
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        depositWeights[cellIndex] = 0;
        if (!isActive[cellIndex]) {
          continue;
        }
        const deltaX = cellCenterX(cellIndex) - centerX;
        const deltaY = cellCenterY(cellIndex) - centerY;
        const weight = Math.exp(-(deltaX * deltaX + deltaY * deltaY) / (2 * GROUNDS_SPREAD_RADIUS * GROUNDS_SPREAD_RADIUS));
        depositWeights[cellIndex] = weight;
        weightSum += weight;
      }
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (depositWeights[cellIndex] <= 0) {
          continue;
        }
        const addedGrams = (grams * depositWeights[cellIndex]) / weightSum;
        const previousGrams = coffeeGrams[cellIndex];
        /* 새로 들어온 마른 가루는 가스를 가득 품고 있습니다 */
        gasRemaining[cellIndex] = (gasRemaining[cellIndex] * previousGrams + addedGrams) / (previousGrams + addedGrams);
        coffeeGrams[cellIndex] = previousGrams + addedGrams;
      }
      state.groundsDepositedGrams += grams;
      settleGrounds(RESTING_SLOPE_MILLIMETERS, 6);
      return grams;
    }

    /* 경사가 기준보다 가파른 곳의 가루를 낮은 이웃 칸으로 옮깁니다 */
    function settleGrounds(restingSlopeMillimeters, iterations) {
      const restingSlopeGrams = restingSlopeMillimeters / bedMillimetersPerGram;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
          if (!isActive[cellIndex]) {
            continue;
          }
          const column = cellIndex % GRID_SIZE;
          if (column + 1 < GRID_SIZE) {
            moveExcessGrounds(cellIndex, cellIndex + 1, restingSlopeGrams);
          }
          if (cellIndex + GRID_SIZE < cellCount) {
            moveExcessGrounds(cellIndex, cellIndex + GRID_SIZE, restingSlopeGrams);
          }
        }
      }
    }

    function moveExcessGrounds(cellIndex, neighborIndex, restingSlopeGrams) {
      if (!isActive[neighborIndex]) {
        return;
      }
      const difference = coffeeGrams[cellIndex] - coffeeGrams[neighborIndex];
      if (Math.abs(difference) <= restingSlopeGrams) {
        return;
      }
      const movedGrams = (Math.abs(difference) - restingSlopeGrams) * 0.25 * Math.sign(difference);
      coffeeGrams[cellIndex] -= movedGrams;
      coffeeGrams[neighborIndex] += movedGrams;
    }

    /* 흔들면 가까운 칸끼리 높이가 맞춰지고(국소), 전체적으로도 평균 높이 쪽으로 조금씩 가라앉습니다 */
    function shakeDripper() {
      if (state.phase === "finished") {
        return;
      }
      let totalCoffee = 0;
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (isActive[cellIndex]) {
          totalCoffee += coffeeGrams[cellIndex];
        }
      }
      const meanCoffee = totalCoffee / activeCellCount;
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (isActive[cellIndex]) {
          coffeeGrams[cellIndex] += (meanCoffee - coffeeGrams[cellIndex]) * SHAKE_LEVELING_FRACTION;
        }
      }
      settleGrounds(SHAKE_SLOPE_MILLIMETERS, 4);
    }

    /* 원두 층 높이의 표준편차(mm). 작을수록 평평합니다 */
    function measureBedUnevenness() {
      let sum = 0;
      let squareSum = 0;
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (!isActive[cellIndex]) {
          continue;
        }
        const heightMillimeters = coffeeGrams[cellIndex] * bedMillimetersPerGram;
        sum += heightMillimeters;
        squareSum += heightMillimeters * heightMillimeters;
      }
      const mean = sum / activeCellCount;
      return Math.sqrt(Math.max(0, squareSum / activeCellCount - mean * mean));
    }

    /* ---------- 붓기 ---------- */

    function setPourPosition(normalizedX, normalizedY) {
      state.pourX = normalizedX;
      state.pourY = normalizedY;
    }

    function startPouring() {
      if (state.phase === "finished") {
        return;
      }
      if (state.phase === "idle") {
        state.phase = "brewing";
        state.initialBedUnevenness = measureBedUnevenness();
        state.groundsAtFirstPourGrams = state.groundsDepositedGrams;
      }
      state.isPouring = true;
      const lastSegment = state.pourSegments[state.pourSegments.length - 1];
      const isContinuingLastPour =
        lastSegment && state.elapsedSeconds - lastSegment.endSecond <= POUR_MERGE_GAP_SECONDS;
      if (!isContinuingLastPour) {
        state.pourSegments.push({ startSecond: state.elapsedSeconds, endSecond: state.elapsedSeconds, grams: 0 });
      }
    }

    function stopPouring() {
      state.isPouring = false;
    }

    function sendStraightToServer(grams) {
      state.wallPouredGrams += grams;
      state.bypassGrams += grams;
      state.beverageGrams += grams;
    }

    /* 드리퍼에 들어온 물을 저울 무게와 지금 붓고 있는 한 번의 붓기에 더합니다 */
    function accountPouredWater(grams) {
      state.totalPouredGrams += grams;
      const currentSegment = state.pourSegments[state.pourSegments.length - 1];
      if (currentSegment) {
        currentSegment.grams += grams;
        currentSegment.endSecond = state.elapsedSeconds;
      }
      state.drawdownCompleteSecond = null;
    }

    function addPouredWater(pourGrams) {
      accountPouredWater(pourGrams);
      /* 물줄기가 원두 층 밖, 즉 필터 종이에 떨어지면 원두를 거치지 않고 바로 흘러내립니다 */
      const pourDistance = Math.sqrt(state.pourX * state.pourX + state.pourY * state.pourY);
      if (pourDistance > 1) {
        sendStraightToServer(pourGrams);
        return;
      }
      distributeWater(state.pourX, state.pourY, pourGrams);
    }

    /* 물 입자 하나가 원두 층(또는 그 위의 물)에 떨어진 경우 */
    function addWaterAt(normalizedX, normalizedY, grams) {
      if (state.phase !== "brewing") {
        return;
      }
      accountPouredWater(grams);
      if (Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY) > 1) {
        sendStraightToServer(grams);
        return;
      }
      distributeWater(normalizedX, normalizedY, grams);
    }

    /* 물 입자가 필터 종이에 떨어진 경우: 원두를 거치지 않고 서버로 흘러내립니다 */
    function addPaperWater(grams) {
      if (state.phase !== "brewing") {
        return;
      }
      accountPouredWater(grams);
      sendStraightToServer(grams);
    }

    /* 드리퍼를 벗어나 작업대에 쏟아진 물. 커피에는 들어가지 않습니다 */
    function addSpilledWater(grams) {
      state.spilledGrams += grams;
    }

    function distributeWater(centerX, centerY, pourGrams) {
      let weightSum = 0;
      const splashCellRange = Math.ceil((POUR_SPLASH_RADIUS * 2.5 * (GRID_SIZE - 1)) / 2);
      const centerColumn = Math.round(((centerX + 1) / 2) * (GRID_SIZE - 1));
      const centerRow = Math.round(((centerY + 1) / 2) * (GRID_SIZE - 1));
      const splashCellIndexes = [];
      const splashWeights = [];
      for (let row = centerRow - splashCellRange; row <= centerRow + splashCellRange; row += 1) {
        for (let column = centerColumn - splashCellRange; column <= centerColumn + splashCellRange; column += 1) {
          if (row < 0 || row >= GRID_SIZE || column < 0 || column >= GRID_SIZE) {
            continue;
          }
          const cellIndex = row * GRID_SIZE + column;
          const deltaX = cellCenterX(cellIndex) - centerX;
          const deltaY = cellCenterY(cellIndex) - centerY;
          const weight = Math.exp(-(deltaX * deltaX + deltaY * deltaY) / (2 * POUR_SPLASH_RADIUS * POUR_SPLASH_RADIUS));
          splashCellIndexes.push(cellIndex);
          splashWeights.push(weight);
          weightSum += weight;
        }
      }
      for (let splashIndex = 0; splashIndex < splashCellIndexes.length; splashIndex += 1) {
        const cellIndex = splashCellIndexes[splashIndex];
        const grams = (pourGrams * splashWeights[splashIndex]) / weightSum;
        if (isActive[cellIndex]) {
          waterMillimeters[cellIndex] += grams * millimetersPerGram;
        } else {
          sendStraightToServer(grams);
        }
      }
    }

    /* ---------- 한 단계 계산 ---------- */

    function calculateSaturation(cellIndex) {
      const capacityGrams = coffeeGrams[cellIndex] * WATER_RETAINED_PER_GRAM_OF_COFFEE;
      if (capacityGrams <= 1e-6) {
        return 0;
      }
      return absorbedGrams[cellIndex] / capacityGrams;
    }

    function computeSurfaceHeights() {
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (!isActive[cellIndex]) {
          continue;
        }
        surfaceHeight[cellIndex] =
          coffeeGrams[cellIndex] * bedMillimetersPerGram +
          BLOOM_RISE_MILLIMETERS * calculateSaturation(cellIndex) * gasRemaining[cellIndex] +
          waterMillimeters[cellIndex];
      }
    }

    function nextFlux(previousFlux, ownHeight, neighborIndex, fluxCoefficient) {
      if (!isActive[neighborIndex]) {
        return 0;
      }
      return Math.max(0, previousFlux * FLUX_DAMPING_PER_STEP + fluxCoefficient * (ownHeight - surfaceHeight[neighborIndex]));
    }

    function updateFlow(stepSeconds) {
      computeSurfaceHeights();
      const fluxCoefficient = (stepSeconds * EFFECTIVE_GRAVITY) / cellSideMillimeters;

      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (!isActive[cellIndex]) {
          continue;
        }
        const column = cellIndex % GRID_SIZE;
        const ownHeight = surfaceHeight[cellIndex];
        fluxRight[cellIndex] = column + 1 < GRID_SIZE ? nextFlux(fluxRight[cellIndex], ownHeight, cellIndex + 1, fluxCoefficient) : 0;
        fluxLeft[cellIndex] = column - 1 >= 0 ? nextFlux(fluxLeft[cellIndex], ownHeight, cellIndex - 1, fluxCoefficient) : 0;
        fluxDown[cellIndex] = cellIndex + GRID_SIZE < cellCount ? nextFlux(fluxDown[cellIndex], ownHeight, cellIndex + GRID_SIZE, fluxCoefficient) : 0;
        fluxUp[cellIndex] = cellIndex - GRID_SIZE >= 0 ? nextFlux(fluxUp[cellIndex], ownHeight, cellIndex - GRID_SIZE, fluxCoefficient) : 0;

        /* 가진 물보다 많이 내보내지 않도록 줄입니다 */
        const totalOutflow = (fluxRight[cellIndex] + fluxLeft[cellIndex] + fluxDown[cellIndex] + fluxUp[cellIndex]) * stepSeconds;
        if (totalOutflow > waterMillimeters[cellIndex] && totalOutflow > 0) {
          const scale = waterMillimeters[cellIndex] / totalOutflow;
          fluxRight[cellIndex] *= scale;
          fluxLeft[cellIndex] *= scale;
          fluxDown[cellIndex] *= scale;
          fluxUp[cellIndex] *= scale;
        }
      }

      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (!isActive[cellIndex]) {
          continue;
        }
        const column = cellIndex % GRID_SIZE;
        let inflow = 0;
        if (column - 1 >= 0) {
          inflow += fluxRight[cellIndex - 1];
        }
        if (column + 1 < GRID_SIZE) {
          inflow += fluxLeft[cellIndex + 1];
        }
        if (cellIndex - GRID_SIZE >= 0) {
          inflow += fluxDown[cellIndex - GRID_SIZE];
        }
        if (cellIndex + GRID_SIZE < cellCount) {
          inflow += fluxUp[cellIndex + GRID_SIZE];
        }
        const outflow = fluxRight[cellIndex] + fluxLeft[cellIndex] + fluxDown[cellIndex] + fluxUp[cellIndex];
        waterMillimeters[cellIndex] = Math.max(0, waterMillimeters[cellIndex] + (inflow - outflow) * stepSeconds);
      }
    }

    /* 젖은 칸의 물이 덜 젖은 이웃 칸으로 번집니다. 물이 직접 닿지 않은 곳도 천천히 젖게 됩니다 */
    function wickBetween(cellIndex, neighborIndex, transferFraction) {
      if (!isActive[neighborIndex]) {
        return;
      }
      const ownCapacity = coffeeGrams[cellIndex] * WATER_RETAINED_PER_GRAM_OF_COFFEE;
      const neighborCapacity = coffeeGrams[neighborIndex] * WATER_RETAINED_PER_GRAM_OF_COFFEE;
      if (ownCapacity < 1e-6 || neighborCapacity < 1e-6) {
        return;
      }
      const saturationDifference = absorbedGrams[cellIndex] / ownCapacity - absorbedGrams[neighborIndex] / neighborCapacity;
      const movedGrams = saturationDifference * Math.min(ownCapacity, neighborCapacity) * transferFraction;
      absorbedGrams[cellIndex] -= movedGrams;
      absorbedGrams[neighborIndex] += movedGrams;
    }

    function updateWicking(stepSeconds) {
      const transferFraction = WICKING_RATE_PER_SECOND * stepSeconds;
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (!isActive[cellIndex]) {
          continue;
        }
        if ((cellIndex % GRID_SIZE) + 1 < GRID_SIZE) {
          wickBetween(cellIndex, cellIndex + 1, transferFraction);
        }
        if (cellIndex + GRID_SIZE < cellCount) {
          wickBetween(cellIndex, cellIndex + GRID_SIZE, transferFraction);
        }
      }
    }

    function updateBedExchange(stepSeconds) {
      let percolatedThisStep = 0;
      let bypassThisStep = 0;
      let waterOnBedGrams = 0;

      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (!isActive[cellIndex]) {
          continue;
        }
        const coffee = coffeeGrams[cellIndex];
        const thicknessMillimeters = coffee * bedMillimetersPerGram;
        let waterGrams = waterMillimeters[cellIndex] * gramsPerMillimeter;
        const capacityGrams = coffee * WATER_RETAINED_PER_GRAM_OF_COFFEE;

        /* 원두가 거의 없는 곳은 물이 필터를 통해 바로 빠집니다 */
        if (thicknessMillimeters < BARE_PAPER_THICKNESS_MILLIMETERS && waterGrams > 0) {
          const bareDrainGrams = Math.min(waterGrams, (waterGrams * BARE_PAPER_DRAIN_RATE_PER_SECOND + 0.002) * stepSeconds);
          waterGrams -= bareDrainGrams;
          bypassThisStep += bareDrainGrams;
        }

        /* 마른 원두가 물을 머금습니다 */
        if (waterGrams > 0 && absorbedGrams[cellIndex] < capacityGrams) {
          const absorbGrams = Math.min(
            waterGrams,
            capacityGrams - absorbedGrams[cellIndex],
            ABSORPTION_RATE_PER_GRAM_OF_COFFEE * coffee * stepSeconds
          );
          absorbedGrams[cellIndex] += absorbGrams;
          waterGrams -= absorbGrams;
        }
        let saturation = 0;
        if (capacityGrams > 1e-6) {
          saturation = Math.min(1, absorbedGrams[cellIndex] / capacityGrams);
        }

        /* 젖은 원두는 가스를 내보냅니다 */
        if (saturation > 0.3) {
          gasRemaining[cellIndex] -= (gasRemaining[cellIndex] * saturation * stepSeconds) / BLOOM_GAS_RELEASE_SECONDS;
        }
        const gasBlocking = 1 - GAS_RESISTANCE * gasRemaining[cellIndex] * saturation;

        /* 젖은 원두 층을 지나 아래로 빠지는 물. 층이 얇은 곳일수록 잘 빠집니다 */
        let drainGrams = 0;
        if (waterGrams > 0 && saturation > 0.5 && thicknessMillimeters >= BARE_PAPER_THICKNESS_MILLIMETERS) {
          const depthMillimeters = waterGrams * millimetersPerGram;
          const thicknessFactor = clamp(referenceBedMillimeters / thicknessMillimeters, MINIMUM_THICKNESS_FACTOR, MAXIMUM_THICKNESS_FACTOR);
          drainGrams = Math.min(
            waterGrams,
            permeability * thicknessFactor * saturation * saturation * gasBlocking *
              (depthMillimeters + PERCOLATION_HEAD_OFFSET_MILLIMETERS) * stepSeconds
          );
          waterGrams -= drainGrams;
          percolatedThisStep += drainGrams;
        }
        drainRateGramsPerSecond[cellIndex] = drainGrams / stepSeconds;

        /* 가장자리 물은 필터 종이를 타고 원두를 거치지 않고 흘러내립니다 */
        if (isWallCell[cellIndex] && waterGrams > 0) {
          const wallBypassGrams = Math.min(waterGrams, waterGrams * WALL_BYPASS_RATE_PER_SECOND * stepSeconds);
          waterGrams -= wallBypassGrams;
          bypassThisStep += wallBypassGrams;
        }

        /* 원두 성분이 녹아 나옵니다 */
        if (saturation > 0 && coffee > 1e-6) {
          const immersion = Math.min(1, (waterGrams * millimetersPerGram) / FULL_IMMERSION_DEPTH_MILLIMETERS);
          const flowPerGram = drainRateGramsPerSecond[cellIndex] / coffee;
          const contact = saturation * gasBlocking * (IMMERSION_CONTACT_WEIGHT * Math.max(immersion, 0.4) + FLOW_CONTACT_WEIGHT * flowPerGram);
          const extractableGrams = MAXIMUM_EXTRACTABLE_FRACTION * coffee - extractedGrams[cellIndex];
          extractedGrams[cellIndex] += Math.max(0, extractableGrams) * (1 - Math.exp(-extractionRate * contact * stepSeconds));
        }

        waterMillimeters[cellIndex] = waterGrams * millimetersPerGram;
        waterOnBedGrams += waterGrams;
      }

      state.percolatedTotalGrams += percolatedThisStep;
      state.bypassGrams += bypassThisStep;
      state.beverageGrams += percolatedThisStep + bypassThisStep;
      state.waterOnBedGrams = waterOnBedGrams;
    }

    function advance(deltaSeconds, pourRateGramsPerSecond) {
      if (state.phase !== "brewing") {
        return;
      }
      let remainingSeconds = deltaSeconds;
      while (remainingSeconds > 1e-9) {
        const stepSeconds = Math.min(MAXIMUM_STEP_SECONDS, remainingSeconds);
        remainingSeconds -= stepSeconds;
        state.elapsedSeconds += stepSeconds;

        if (state.isPouring && pourRateGramsPerSecond > 0) {
          addPouredWater(pourRateGramsPerSecond * stepSeconds);
        }
        updateFlow(stepSeconds);
        updateWicking(stepSeconds);
        updateBedExchange(stepSeconds);

        const isBedEmpty = state.waterOnBedGrams < EMPTY_WATER_THRESHOLD_GRAMS;
        if (isBedEmpty && !state.isPouring && state.totalPouredGrams > 0 && state.drawdownCompleteSecond === null) {
          state.drawdownCompleteSecond = state.elapsedSeconds;
        }
      }
    }

    /* 목표량을 거의 다 붓고 물도 다 빠졌으면 추출이 끝난 것으로 봅니다 */
    function isNaturallyComplete() {
      return (
        state.phase === "brewing" &&
        !state.isPouring &&
        state.drawdownCompleteSecond !== null &&
        state.totalPouredGrams >= targetWaterGrams * 0.9
      );
    }

    /* ---------- 결과 ---------- */

    function analyzeBloom() {
      const meaningfulSegments = state.pourSegments.filter(function isMeaningful(segment) {
        return segment.grams >= 5;
      });
      const firstSegment = meaningfulSegments[0];
      const secondSegment = meaningfulSegments[1];
      const groundsAtFirstPour = state.groundsAtFirstPourGrams || 0;
      if (!firstSegment) {
        return { quality: "none", waitSeconds: 0, bloomRatio: 0 };
      }
      const bloomRatio = firstSegment.grams / Math.max(groundsAtFirstPour, 1e-6);
      let waitSeconds = 0;
      if (secondSegment) {
        waitSeconds = secondSegment.startSecond - firstSegment.endSecond;
      }
      let quality = "good";
      if (groundsAtFirstPour < MINIMUM_COFFEE_FOR_RESULT_GRAMS) {
        quality = "no-coffee";
      } else if (!secondSegment || waitSeconds < MINIMUM_BLOOM_WAIT_SECONDS) {
        quality = "skipped";
      } else if (bloomRatio < 1.8) {
        quality = "too-little-water";
      } else if (bloomRatio > 3.6) {
        quality = "too-much-water";
      }
      return { quality: quality, waitSeconds: waitSeconds, bloomRatio: bloomRatio };
    }

    function getCellExtractionPercent(cellIndex) {
      if (!isActive[cellIndex] || coffeeGrams[cellIndex] < 1e-6) {
        return 0;
      }
      return (extractedGrams[cellIndex] / coffeeGrams[cellIndex]) * 100;
    }

    function evaluateResult() {
      const doseGrams = state.groundsDepositedGrams;
      const hasCoffee = doseGrams >= MINIMUM_COFFEE_FOR_RESULT_GRAMS;
      let totalExtractedGrams = 0;
      let totalRetainedGrams = 0;
      let weightedSum = 0;
      let weightedSquareSum = 0;
      let dryCoffeeGrams = 0;

      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        if (!isActive[cellIndex]) {
          continue;
        }
        const coffee = coffeeGrams[cellIndex];
        totalExtractedGrams += extractedGrams[cellIndex];
        totalRetainedGrams += absorbedGrams[cellIndex];
        const cellPercent = getCellExtractionPercent(cellIndex);
        weightedSum += cellPercent * coffee;
        weightedSquareSum += cellPercent * cellPercent * coffee;
        if (absorbedGrams[cellIndex] < coffee * WATER_RETAINED_PER_GRAM_OF_COFFEE * 0.9) {
          dryCoffeeGrams += coffee;
        }
      }

      let uniformityPercent = 0;
      let dryCoffeePercent = 0;
      if (hasCoffee) {
        const meanCellPercent = weightedSum / doseGrams;
        const cellDeviation = Math.sqrt(Math.max(0, weightedSquareSum / doseGrams - meanCellPercent * meanCellPercent));
        uniformityPercent = clamp(100 - (cellDeviation / Math.max(1e-6, meanCellPercent)) * 150, 0, 100);
        dryCoffeePercent = (dryCoffeeGrams / doseGrams) * 100;
      }

      /* 녹아 나온 성분은 원두 층의 물에 고르게 섞여 있다고 보고, 빠져나온 물의 비율만큼 서버로 갑니다 */
      const leftoverWaterGrams = state.waterOnBedGrams;
      const liquidThroughBedGrams = state.percolatedTotalGrams + totalRetainedGrams + leftoverWaterGrams;
      let beverageSolubleGrams = 0;
      if (liquidThroughBedGrams > 0) {
        beverageSolubleGrams = (totalExtractedGrams * state.percolatedTotalGrams) / liquidThroughBedGrams;
      }

      let extractionPercent = 0;
      if (hasCoffee) {
        extractionPercent = (beverageSolubleGrams / doseGrams) * 100;
      }
      let strengthPercent = 0;
      if (state.beverageGrams > 1) {
        strengthPercent = (beverageSolubleGrams / state.beverageGrams) * 100;
      }

      let extractionZone = "ideal";
      if (extractionPercent < IDEAL_EXTRACTION_LOW) {
        extractionZone = "under";
      } else if (extractionPercent > IDEAL_EXTRACTION_HIGH) {
        extractionZone = "over";
      }
      let strengthZone = "ideal";
      if (strengthPercent < IDEAL_STRENGTH_LOW) {
        strengthZone = "weak";
      } else if (strengthPercent > IDEAL_STRENGTH_HIGH) {
        strengthZone = "strong";
      }

      let contactSeconds = state.elapsedSeconds;
      if (state.drawdownCompleteSecond !== null) {
        contactSeconds = state.drawdownCompleteSecond;
      }

      return {
        hasCoffee: hasCoffee,
        doseGrams: doseGrams,
        contactSeconds: contactSeconds,
        totalPouredGrams: state.totalPouredGrams,
        beverageGrams: state.beverageGrams,
        leftoverWaterGrams: leftoverWaterGrams,
        bypassGrams: state.bypassGrams,
        wallPouredGrams: state.wallPouredGrams,
        spilledGrams: state.spilledGrams,
        dryCoffeePercent: dryCoffeePercent,
        uniformityPercent: uniformityPercent,
        initialBedUnevenness: state.initialBedUnevenness,
        finesFraction: finesFraction,
        pourCount: state.pourSegments.filter(function isMeaningful(segment) {
          return segment.grams >= 5;
        }).length,
        bloom: analyzeBloom(),
        extractionPercent: extractionPercent,
        strengthPercent: strengthPercent,
        extractionZone: extractionZone,
        strengthZone: strengthZone
      };
    }

    function finish() {
      if (state.phase !== "brewing") {
        return null;
      }
      state.isPouring = false;
      state.phase = "finished";
      return evaluateResult();
    }

    /* 매 프레임 칸 상태를 한꺼번에 읽어 갈 수 있도록 미리 만든 배열에 채워 줍니다 */
    function exportCellState(target) {
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        const saturation = Math.min(1, calculateSaturation(cellIndex));
        const coffeeMillimeters = coffeeGrams[cellIndex] * bedMillimetersPerGram;
        target.coffeeMillimeters[cellIndex] = coffeeMillimeters;
        target.bedMillimeters[cellIndex] = coffeeMillimeters + BLOOM_RISE_MILLIMETERS * saturation * gasRemaining[cellIndex];
        target.waterMillimeters[cellIndex] = waterMillimeters[cellIndex];
        target.saturation[cellIndex] = saturation;
        target.gasRemaining[cellIndex] = gasRemaining[cellIndex];
        target.extractionPercent[cellIndex] = getCellExtractionPercent(cellIndex);
      }
    }

    return {
      gridSize: GRID_SIZE,
      cellCount: cellCount,
      isActive: isActive,
      referenceBedMillimeters: referenceBedMillimeters,
      settings: settings,
      state: state,
      targetWaterGrams: targetWaterGrams,
      setFinesFraction: setFinesFraction,
      depositGrounds: depositGrounds,
      shakeDripper: shakeDripper,
      measureBedUnevenness: measureBedUnevenness,
      setPourPosition: setPourPosition,
      addWaterAt: addWaterAt,
      addPaperWater: addPaperWater,
      addSpilledWater: addSpilledWater,
      startPouring: startPouring,
      stopPouring: stopPouring,
      advance: advance,
      isNaturallyComplete: isNaturallyComplete,
      finish: finish,
      exportCellState: exportCellState
    };
  }

  /* ---------- 점수 ----------
     100점 = 추출 수율 35 + 농도 20 + 균일도 20 + 기술 25(뜸 8, 필터 벽 7, 시간 5, 분쇄 5)
     가장 많이 깎인 항목을 한줄평의 지적 사항으로 씁니다. */

  function scoreLinearly(value, idealLow, idealHigh, zeroDistance, maximumPoints) {
    if (value >= idealLow && value <= idealHigh) {
      return maximumPoints;
    }
    let distance = value - idealHigh;
    if (value < idealLow) {
      distance = idealLow - value;
    }
    return Math.max(0, maximumPoints * (1 - distance / zeroDistance));
  }

  function scoreBloom(bloomQuality) {
    if (bloomQuality === "good") {
      return 8;
    }
    if (bloomQuality === "too-little-water" || bloomQuality === "too-much-water") {
      return 4;
    }
    return 0;
  }

  function scoreBrew(result, expectation) {
    if (!result.hasCoffee) {
      return {
        totalScore: 0,
        oneLineReview: "원두 없이 뜨거운 물만 내렸습니다. 원두를 갈아 드리퍼에 담아 보세요.",
        breakdown: []
      };
    }

    const breakdown = [
      {
        key: "extraction",
        label: "추출 수율",
        maximum: 35,
        points: scoreLinearly(result.extractionPercent, IDEAL_EXTRACTION_LOW, IDEAL_EXTRACTION_HIGH, 4, 35)
      },
      {
        key: "strength",
        label: "농도",
        maximum: 20,
        points: scoreLinearly(result.strengthPercent, IDEAL_STRENGTH_LOW, IDEAL_STRENGTH_HIGH, 0.45, 20)
      },
      {
        key: "uniformity",
        label: "균일도",
        maximum: 20,
        points: 20 * clamp((result.uniformityPercent - 40) / 45, 0, 1)
      },
      { key: "bloom", label: "뜸 들이기", maximum: 8, points: scoreBloom(result.bloom.quality) },
      {
        key: "wall",
        label: "필터 벽 피하기",
        maximum: 7,
        points: 7 * clamp(1 - (result.wallPouredGrams - 3) / 30, 0, 1)
      },
      {
        key: "time",
        label: "추출 시간",
        maximum: 5,
        points: scoreLinearly(result.contactSeconds, expectation.targetLowSeconds, expectation.targetHighSeconds, 60, 5)
      },
      {
        key: "grind",
        label: "고른 분쇄",
        maximum: 5,
        points: 5 * clamp(1 - (result.finesFraction - 0.1) / 0.15, 0, 1)
      }
    ];

    let totalScore = 0;
    let biggestLoss = null;
    breakdown.forEach(function addPoints(item) {
      totalScore += item.points;
      const loss = item.maximum - item.points;
      if (loss > 0.5 && (!biggestLoss || loss > biggestLoss.loss)) {
        biggestLoss = { key: item.key, loss: loss };
      }
    });
    totalScore = Math.round(totalScore);

    const issueTexts = {
      extraction: result.extractionZone === "over" ? "너무 우러나 쓴맛이 남습니다" : "덜 우러나 신맛이 앞섭니다",
      strength: result.strengthZone === "strong" ? "조금 진합니다" : "조금 묽습니다",
      uniformity: "물이 원두 층에 고르게 닿지 않았습니다",
      bloom: "뜸 들이기가 아쉽습니다",
      wall: "필터 벽으로 흘러내린 물이 많습니다",
      time: "추출 시간이 레시피와 많이 다릅니다",
      grind: "그라인더를 급하게 돌려 미분이 많습니다"
    };
    let issue = "";
    if (biggestLoss) {
      issue = issueTexts[biggestLoss.key];
    }

    let oneLineReview = "카페에서 내놓아도 손색없는 한 잔입니다.";
    if (totalScore < 30) {
      oneLineReview = "다시 도전해 볼까요? " + issue + ".";
    } else if (totalScore < 55) {
      oneLineReview = "아쉬운 한 잔입니다. " + issue + ".";
    } else if (totalScore < 75) {
      oneLineReview = "마실 만하지만 " + issue + ".";
    } else if (totalScore < 92) {
      oneLineReview = "좋은 한 잔입니다. 다만 " + issue + ".";
    }

    return { totalScore: totalScore, oneLineReview: oneLineReview, breakdown: breakdown };
  }

  const FluidBrewModel = {
    createBrewModel: createBrewModel,
    scoreBrew: scoreBrew,
    pourRates: POUR_RATES_GRAMS_PER_SECOND,
    idealRange: {
      extractionLow: IDEAL_EXTRACTION_LOW,
      extractionHigh: IDEAL_EXTRACTION_HIGH,
      strengthLow: IDEAL_STRENGTH_LOW,
      strengthHigh: IDEAL_STRENGTH_HIGH
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FluidBrewModel;
  } else {
    globalScope.CoffeeSession = globalScope.CoffeeSession || {};
    globalScope.CoffeeSession.FluidBrewModel = FluidBrewModel;
  }
})(typeof window !== "undefined" ? window : globalThis);
