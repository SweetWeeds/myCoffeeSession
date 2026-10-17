/* 떨어지는 물줄기와 물방울의 유체 근사 모델.
   주전자 주둥이의 물줄기와 드리퍼 아래로 떨어지는 커피 모두 이 모델로 계산합니다.
   길이 단위는 cm, 질량 단위는 g, 시간 단위는 초입니다(물의 표면장력 72 g/s², 밀도 1 g/cm³).

   - 물은 출구에서 아주 짧은 간격으로 작은 물 덩어리(입자)로 나오고, 중력과 공기 저항을 받으며 떨어집니다.
     주전자를 움직이면 이미 나온 물은 그 순간의 주둥이 속도를 그대로 갖고 날아가 물줄기가 휘어집니다.
   - 흐르는 양이 같으므로 물줄기는 떨어지며 빨라질수록 가늘어집니다(연속 방정식).
   - 표면장력 때문에 물줄기 표면의 아주 작은 출렁임이 점점 커집니다(레일리-플라토 불안정).
     가장 빨리 자라는 출렁임의 파장은 물줄기 반지름의 약 9배이고, 자라는 속도는 0.34·√(γ/ρr³)입니다.
     가늘어질수록 더 빨리 자라고, 출렁임이 반지름만큼 커지면 잘록한 곳이 끊어져
     한 파장 길이만큼의 물이 하나의 물방울로 뭉칩니다(질량과 운동량 보존).
   - 흐름이 약하면 출구에 물방울이 매달려 커지다가, 무게가 표면장력을 이기면 떨어집니다(테이트의 법칙).
   - 각 입자가 어디에 닿는지는 호출하는 쪽이 정합니다(원두 층, 필터 종이, 서버, 작업대 등).
   화면 코드와 분리되어 있어 Node에서도 시험할 수 있습니다. */

(function defineStreamPhysics(globalScope) {
  const GRAVITY_CENTIMETERS_PER_SECOND_SQUARED = 981;
  const WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER = 1;
  const SURFACE_TENSION_GRAMS_PER_SECOND_SQUARED = 72;
  const AIR_DRAG_PER_SECOND = 0.6;
  const STEP_SECONDS = 1 / 240;
  /* 레일리-플라토 불안정: 가장 빨리 자라는 파장(반지름의 배수)과 성장률 계수 */
  const FASTEST_WAVELENGTH_PER_RADIUS = 9.02;
  const GROWTH_RATE_COEFFICIENT = 0.343;
  /* 물줄기가 처음 나올 때 표면 출렁임의 크기(반지름 대비). 주둥이 떨림, 물 흐름의 흔들림에서 생깁니다 */
  const MINIMUM_INITIAL_AMPLITUDE = 0.03;
  const MAXIMUM_INITIAL_AMPLITUDE = 0.06;
  /* 물줄기가 옆으로 살짝 흔들리는 정도(주둥이 속 흐름이 완전히 고르지 않아서 생깁니다) */
  const SIDEWAYS_JITTER_FRACTION = 0.012;
  /* 같은 줄기에서 이웃 입자끼리 옆으로 벌어지지 않게 붙잡는 표면장력 효과 */
  const COHESION_PER_SECOND = 40;
  /* 물방울이 출구에서 떨어지는 무게. 지름 6mm 출구에서 물일 때 대략 이 정도입니다 */
  const DEFAULT_DROP_DETACH_GRAMS = 0.12;
  const MERGE_LOOKBACK_COUNT = 12;
  /* 사람이 주전자를 옮기는 속도는 빨라야 초속 수십 cm라서, 물이 물려받는 속도도 이 정도로 제한합니다 */
  const DEFAULT_MAXIMUM_INHERITED_SPEED = 30;
  /* 출구에서 나온 물은 위로 솟구치지 않습니다. 주전자를 들어 올리는 속도는 물려받지 않습니다 */
  const MAXIMUM_INHERITED_UPWARD_SPEED = 0;
  /* 10cm 높이에서 떨어지는 데 0.15초면 충분하므로, 이보다 오래 공중에 있는 입자는 계산 오류로 보고 지웁니다 */
  const MAXIMUM_PARTICLE_AGE_SECONDS = 3;
  /* 출렁임이 이만큼 자라면 한 파장 안의 물이 다 모였다고 보고 독립된 물방울로 다룹니다 */
  const DROP_SETTLED_AMPLITUDE = 1.6;

  function createStreamSimulation(options) {
    const maximumParticles = options.maximumParticles;
    const outletRadiusCentimeters = options.outletRadiusCentimeters;
    const outletArea = Math.PI * outletRadiusCentimeters * outletRadiusCentimeters;
    const jetThresholdGramsPerSecond = options.jetThresholdGramsPerSecond;
    const dropDetachGrams = options.dropDetachGrams || DEFAULT_DROP_DETACH_GRAMS;
    const maximumInheritedSpeed = options.maximumInheritedSpeed || DEFAULT_MAXIMUM_INHERITED_SPEED;

    const positionX = new Float32Array(maximumParticles);
    const positionY = new Float32Array(maximumParticles);
    const positionZ = new Float32Array(maximumParticles);
    const velocityX = new Float32Array(maximumParticles);
    const velocityY = new Float32Array(maximumParticles);
    const velocityZ = new Float32Array(maximumParticles);
    const mass = new Float32Array(maximumParticles);
    const age = new Float32Array(maximumParticles);
    const flowAtEmission = new Float32Array(maximumParticles);
    /* 물줄기를 따라 잰 위치(출구에서 나온 순서대로 쌓인 길이). 출렁임의 위상을 정합니다 */
    const materialCoordinate = new Float32Array(maximumParticles);
    const wavelength = new Float32Array(maximumParticles);
    const amplitude = new Float32Array(maximumParticles);
    const streamIdentifier = new Int32Array(maximumParticles);
    const isDrop = new Uint8Array(maximumParticles);
    const isAlive = new Uint8Array(maximumParticles);

    let nextParticleIndex = 0;
    let aliveCount = 0;
    let currentStreamIdentifier = 0;
    let wasJetting = false;
    let hangingDropGrams = 0;
    let lastFlowGramsPerSecond = 0;
    let streamLength = 0;
    let streamInitialAmplitude = MAXIMUM_INITIAL_AMPLITUDE;
    let emissionCarrySeconds = 0;

    /* 흐르는 양(g/s)을 출구 넓이로 나누면 물이 나오는 속도(cm/s)가 됩니다 */
    function exitSpeedFor(flowGramsPerSecond) {
      return flowGramsPerSecond / (WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER * outletArea);
    }

    function dropRadiusFor(particleMass) {
      return Math.cbrt((3 * particleMass) / (4 * Math.PI * WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER));
    }

    function speedOf(particleIndex) {
      return Math.sqrt(
        velocityX[particleIndex] * velocityX[particleIndex] +
        velocityY[particleIndex] * velocityY[particleIndex] +
        velocityZ[particleIndex] * velocityZ[particleIndex]
      );
    }

    /* 이어진 물줄기의 굵기: 흐르는 양이 같으므로 빨라질수록 가늘어집니다 */
    function streamRadiusAt(particleIndex) {
      const speed = speedOf(particleIndex);
      const flow = flowAtEmission[particleIndex];
      if (isDrop[particleIndex] || speed < 1e-3 || flow <= 0) {
        return dropRadiusFor(mass[particleIndex]);
      }
      return Math.sqrt(flow / (Math.PI * WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER * speed));
    }

    function growthRateFor(radius) {
      return GROWTH_RATE_COEFFICIENT * Math.sqrt(
        SURFACE_TENSION_GRAMS_PER_SECOND_SQUARED / (WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER * radius * radius * radius)
      );
    }

    function startNewStream() {
      currentStreamIdentifier += 1;
      streamLength = 0;
      streamInitialAmplitude =
        MINIMUM_INITIAL_AMPLITUDE + Math.random() * (MAXIMUM_INITIAL_AMPLITUDE - MINIMUM_INITIAL_AMPLITUDE);
    }

    function spawnParticle(originX, originY, originZ, velocityValues, particleMass, flowGramsPerSecond, isDetachedDrop) {
      const particleIndex = nextParticleIndex;
      nextParticleIndex = (nextParticleIndex + 1) % maximumParticles;
      if (!isAlive[particleIndex]) {
        aliveCount += 1;
      }
      positionX[particleIndex] = originX;
      positionY[particleIndex] = originY;
      positionZ[particleIndex] = originZ;
      velocityX[particleIndex] = velocityValues.x;
      velocityY[particleIndex] = velocityValues.y;
      velocityZ[particleIndex] = velocityValues.z;
      mass[particleIndex] = particleMass;
      age[particleIndex] = 0;
      flowAtEmission[particleIndex] = flowGramsPerSecond;
      streamIdentifier[particleIndex] = currentStreamIdentifier;
      isDrop[particleIndex] = isDetachedDrop ? 1 : 0;
      isAlive[particleIndex] = 1;
      if (!isDetachedDrop) {
        const exitRadius = Math.sqrt(outletArea / Math.PI);
        materialCoordinate[particleIndex] = streamLength;
        wavelength[particleIndex] = FASTEST_WAVELENGTH_PER_RADIUS * exitRadius;
        /* 입자마다 출렁임 크기가 조금씩 달라야 끊어지는 위치가 매번 같지 않습니다 */
        amplitude[particleIndex] = streamInitialAmplitude * (0.8 + Math.random() * 0.4);
      } else {
        amplitude[particleIndex] = 1;
      }
    }

    function previousIndex(particleIndex) {
      return (particleIndex + maximumParticles - 1) % maximumParticles;
    }

    function killParticle(particleIndex) {
      if (isAlive[particleIndex]) {
        isAlive[particleIndex] = 0;
        aliveCount -= 1;
      }
    }

    function isIntactStream(particleIndex) {
      return isAlive[particleIndex] && !isDrop[particleIndex] && amplitude[particleIndex] < 1;
    }

    function waveNumberOf(particleIndex) {
      return Math.floor(materialCoordinate[particleIndex] / wavelength[particleIndex] + 0.5);
    }

    /* 같은 줄기에서 바로 앞에 나온 살아 있는 입자를 찾습니다(합쳐져 빈 자리는 건너뜁니다) */
    function previousAliveInStream(particleIndex) {
      let candidateIndex = previousIndex(particleIndex);
      for (let lookback = 0; lookback < MERGE_LOOKBACK_COUNT; lookback += 1) {
        if (isAlive[candidateIndex]) {
          if (streamIdentifier[candidateIndex] === streamIdentifier[particleIndex]) {
            return candidateIndex;
          }
          return -1;
        }
        candidateIndex = previousIndex(candidateIndex);
      }
      return -1;
    }

    /* 끊어진 부분은 한 파장 안의 물이 하나로 뭉쳐 물방울이 됩니다 */
    function formDrops() {
      for (let particleIndex = 0; particleIndex < maximumParticles; particleIndex += 1) {
        if (!isAlive[particleIndex] || isDrop[particleIndex] || amplitude[particleIndex] < 1) {
          continue;
        }
        const neighborIndex = previousAliveInStream(particleIndex);
        const canMerge =
          neighborIndex >= 0 &&
          amplitude[neighborIndex] >= 1 &&
          !isDrop[neighborIndex] &&
          waveNumberOf(neighborIndex) === waveNumberOf(particleIndex);
        if (!canMerge) {
          continue;
        }
        const totalMass = mass[particleIndex] + mass[neighborIndex];
        const ownShare = mass[particleIndex] / totalMass;
        const neighborShare = mass[neighborIndex] / totalMass;
        positionX[neighborIndex] = positionX[particleIndex] * ownShare + positionX[neighborIndex] * neighborShare;
        positionY[neighborIndex] = positionY[particleIndex] * ownShare + positionY[neighborIndex] * neighborShare;
        positionZ[neighborIndex] = positionZ[particleIndex] * ownShare + positionZ[neighborIndex] * neighborShare;
        velocityX[neighborIndex] = velocityX[particleIndex] * ownShare + velocityX[neighborIndex] * neighborShare;
        velocityY[neighborIndex] = velocityY[particleIndex] * ownShare + velocityY[neighborIndex] * neighborShare;
        velocityZ[neighborIndex] = velocityZ[particleIndex] * ownShare + velocityZ[neighborIndex] * neighborShare;
        materialCoordinate[neighborIndex] = materialCoordinate[particleIndex] * ownShare + materialCoordinate[neighborIndex] * neighborShare;
        mass[neighborIndex] = totalMass;
        killParticle(particleIndex);
      }
      /* 한 파장 안의 물을 다 모은 덩어리는 이제 독립된 물방울입니다 */
      for (let particleIndex = 0; particleIndex < maximumParticles; particleIndex += 1) {
        if (!isAlive[particleIndex] || isDrop[particleIndex] || amplitude[particleIndex] < DROP_SETTLED_AMPLITUDE) {
          continue;
        }
        isDrop[particleIndex] = 1;
      }
    }

    /* 아직 끊어지지 않은 이웃과 옆 방향 속도를 맞춰 한 줄기로 유지합니다 */
    function applyCohesion(particleIndex, stepSeconds) {
      if (!isIntactStream(particleIndex)) {
        return;
      }
      const neighborIndex = previousIndex(particleIndex);
      if (!isIntactStream(neighborIndex) || streamIdentifier[neighborIndex] !== streamIdentifier[particleIndex]) {
        return;
      }
      const blend = Math.min(1, COHESION_PER_SECOND * stepSeconds) * 0.5;
      const averageVelocityX = (velocityX[particleIndex] + velocityX[neighborIndex]) / 2;
      const averageVelocityZ = (velocityZ[particleIndex] + velocityZ[neighborIndex]) / 2;
      velocityX[particleIndex] += (averageVelocityX - velocityX[particleIndex]) * blend;
      velocityZ[particleIndex] += (averageVelocityZ - velocityZ[particleIndex]) * blend;
      velocityX[neighborIndex] += (averageVelocityX - velocityX[neighborIndex]) * blend;
      velocityZ[neighborIndex] += (averageVelocityZ - velocityZ[neighborIndex]) * blend;
    }

    const emissionVelocity = { x: 0, y: 0, z: 0 };

    /* 한 단계 동안 출구에서 물을 내보냅니다. 출구 위치는 이전 위치에서 지금 위치로 나눠 옮겨 가며 내보내
       주전자를 움직여도 물줄기가 끊기지 않고 휘어 보이도록 합니다 */
    function emitDuringStep(stepSeconds, originX, originY, originZ, direction, originVelocity, flowGramsPerSecond) {
      lastFlowGramsPerSecond = flowGramsPerSecond;
      if (flowGramsPerSecond <= 0.01) {
        if (wasJetting) {
          startNewStream();
        }
        wasJetting = false;
        return;
      }

      if (flowGramsPerSecond < jetThresholdGramsPerSecond) {
        if (wasJetting) {
          startNewStream();
          wasJetting = false;
        }
        hangingDropGrams += flowGramsPerSecond * stepSeconds;
        if (hangingDropGrams >= dropDetachGrams) {
          emissionVelocity.x = originVelocity.x + direction.x * 5;
          emissionVelocity.y = originVelocity.y + direction.y * 5;
          emissionVelocity.z = originVelocity.z + direction.z * 5;
          spawnParticle(originX, originY, originZ, emissionVelocity, hangingDropGrams, 0, true);
          startNewStream();
          hangingDropGrams = 0;
        }
        return;
      }

      if (!wasJetting) {
        startNewStream();
      }
      wasJetting = true;
      emissionCarrySeconds += stepSeconds;
      if (emissionCarrySeconds < STEP_SECONDS * 0.999) {
        return;
      }
      const emittedSeconds = emissionCarrySeconds;
      emissionCarrySeconds = 0;
      const speed = exitSpeedFor(flowGramsPerSecond);
      const jitterX = (Math.random() - 0.5) * 2 * SIDEWAYS_JITTER_FRACTION * speed;
      const jitterZ = (Math.random() - 0.5) * 2 * SIDEWAYS_JITTER_FRACTION * speed;
      emissionVelocity.x = originVelocity.x + direction.x * speed + jitterX;
      emissionVelocity.y = originVelocity.y + direction.y * speed;
      emissionVelocity.z = originVelocity.z + direction.z * speed + jitterZ;
      const particleMass = flowGramsPerSecond * emittedSeconds + hangingDropGrams;
      hangingDropGrams = 0;
      spawnParticle(originX, originY, originZ, emissionVelocity, particleMass, flowGramsPerSecond, false);
      streamLength += speed * emittedSeconds;
    }

    function moveParticles(stepSeconds, landingTest) {
      const dragFactor = Math.exp(-AIR_DRAG_PER_SECOND * stepSeconds);
      for (let particleIndex = 0; particleIndex < maximumParticles; particleIndex += 1) {
        if (!isAlive[particleIndex]) {
          continue;
        }
        age[particleIndex] += stepSeconds;
        const isNumberValid = Number.isFinite(positionX[particleIndex]) && Number.isFinite(positionY[particleIndex]) && Number.isFinite(positionZ[particleIndex]);
        if (age[particleIndex] > MAXIMUM_PARTICLE_AGE_SECONDS || !isNumberValid) {
          killParticle(particleIndex);
          continue;
        }
        velocityY[particleIndex] -= GRAVITY_CENTIMETERS_PER_SECOND_SQUARED * stepSeconds;
        velocityX[particleIndex] *= dragFactor;
        velocityZ[particleIndex] *= dragFactor;
        applyCohesion(particleIndex, stepSeconds);

        /* 표면 출렁임은 지금 굵기에서의 성장률로 자랍니다. 가늘어질수록 빨리 자랍니다 */
        if (!isDrop[particleIndex]) {
          const radius = Math.max(0.005, streamRadiusAt(particleIndex));
          amplitude[particleIndex] *= Math.exp(growthRateFor(radius) * stepSeconds);
        }

        positionX[particleIndex] += velocityX[particleIndex] * stepSeconds;
        positionY[particleIndex] += velocityY[particleIndex] * stepSeconds;
        positionZ[particleIndex] += velocityZ[particleIndex] * stepSeconds;
        if (landingTest(particleIndex)) {
          killParticle(particleIndex);
        }
      }
      formDrops();
    }

    /* previousOrigin → origin 으로 출구가 옮겨 가는 동안 물을 내보내며 deltaSeconds만큼 계산합니다 */
    function advance(deltaSeconds, previousOrigin, origin, direction, flowGramsPerSecond, landingTest) {
      const stepCount = Math.max(1, Math.ceil(deltaSeconds / STEP_SECONDS - 1e-6));
      const stepSeconds = deltaSeconds / stepCount;
      const originVelocity = {
        x: deltaSeconds > 0 ? (origin.x - previousOrigin.x) / deltaSeconds : 0,
        y: deltaSeconds > 0 ? (origin.y - previousOrigin.y) / deltaSeconds : 0,
        z: deltaSeconds > 0 ? (origin.z - previousOrigin.z) / deltaSeconds : 0
      };
      const originSpeed = Math.sqrt(originVelocity.x * originVelocity.x + originVelocity.y * originVelocity.y + originVelocity.z * originVelocity.z);
      if (originSpeed > maximumInheritedSpeed) {
        const speedScale = maximumInheritedSpeed / originSpeed;
        originVelocity.x *= speedScale;
        originVelocity.y *= speedScale;
        originVelocity.z *= speedScale;
      }
      originVelocity.y = Math.min(originVelocity.y, MAXIMUM_INHERITED_UPWARD_SPEED);
      for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
        const fraction = (stepIndex + 1) / stepCount;
        const originX = previousOrigin.x + (origin.x - previousOrigin.x) * fraction;
        const originY = previousOrigin.y + (origin.y - previousOrigin.y) * fraction;
        const originZ = previousOrigin.z + (origin.z - previousOrigin.z) * fraction;
        moveParticles(stepSeconds, landingTest);
        emitDuringStep(stepSeconds, originX, originY, originZ, direction, originVelocity, flowGramsPerSecond);
      }
    }

    /* 화면에 이어진 물줄기를 그릴 수 있도록, 가장 최근 줄기의 끊어지지 않은 입자를 출구 쪽부터 차례로 돌려줍니다 */
    function collectIntactStream(maximumPoints, targetIndexes) {
      let count = 0;
      let particleIndex = previousIndex(nextParticleIndex);
      if (!isIntactStream(particleIndex) || streamIdentifier[particleIndex] !== currentStreamIdentifier) {
        return 0;
      }
      while (count < maximumPoints && isIntactStream(particleIndex) && streamIdentifier[particleIndex] === currentStreamIdentifier) {
        targetIndexes[count] = particleIndex;
        count += 1;
        particleIndex = previousIndex(particleIndex);
      }
      return count;
    }

    /* 그리기용: 이 입자 위치에서 물줄기 반지름이 출렁임 때문에 얼마나 굵거나 가는지(0이면 끊어지는 지점) */
    function surfaceWaveFactor(particleIndex, coordinateOffset) {
      const phase = (2 * Math.PI * (materialCoordinate[particleIndex] + coordinateOffset)) / wavelength[particleIndex];
      return 1 + Math.min(0.97, amplitude[particleIndex]) * Math.cos(phase);
    }

    function reset() {
      isAlive.fill(0);
      aliveCount = 0;
      hangingDropGrams = 0;
      emissionCarrySeconds = 0;
      wasJetting = false;
      startNewStream();
    }

    return {
      maximumParticles: maximumParticles,
      positionX: positionX,
      positionY: positionY,
      positionZ: positionZ,
      velocityX: velocityX,
      velocityY: velocityY,
      velocityZ: velocityZ,
      mass: mass,
      age: age,
      amplitude: amplitude,
      materialCoordinate: materialCoordinate,
      wavelength: wavelength,
      isAlive: isAlive,
      isDrop: isDrop,
      advance: advance,
      reset: reset,
      exitSpeedFor: exitSpeedFor,
      dropRadiusFor: dropRadiusFor,
      streamRadiusAt: streamRadiusAt,
      surfaceWaveFactor: surfaceWaveFactor,
      isIntactStream: isIntactStream,
      collectIntactStream: collectIntactStream,
      streamIdentifier: streamIdentifier,
      getAliveCount: function getAliveCount() {
        return aliveCount;
      },
      /* 가장 최근에 나온 입자 번호. 그리기에서 출구 쪽부터 거슬러 올라갈 때 씁니다 */
      getNewestIndex: function getNewestIndex() {
        return previousIndex(nextParticleIndex);
      },
      getCurrentStreamIdentifier: function getCurrentStreamIdentifier() {
        return currentStreamIdentifier;
      },
      getHangingDropGrams: function getHangingDropGrams() {
        return hangingDropGrams;
      },
      isJetting: function isJetting() {
        return wasJetting && lastFlowGramsPerSecond >= jetThresholdGramsPerSecond;
      }
    };
  }

  const StreamPhysics = {
    createStreamSimulation: createStreamSimulation,
    gravity: GRAVITY_CENTIMETERS_PER_SECOND_SQUARED
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = StreamPhysics;
  } else {
    globalScope.CoffeeSession = globalScope.CoffeeSession || {};
    globalScope.CoffeeSession.StreamPhysics = StreamPhysics;
  }
})(typeof window !== "undefined" ? window : globalThis);
