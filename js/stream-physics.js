/* 떨어지는 물줄기와 물방울의 유체 근사 모델.
   주전자 주둥이의 물줄기와 드리퍼 아래로 떨어지는 커피 모두 이 모델로 계산합니다.

   - 물은 일정한 간격으로 작은 물 덩어리(입자)로 나와 중력과 공기 저항을 받으며 떨어집니다.
   - 같은 줄기에서 연달아 나온 입자들은 표면장력 때문에 서로 끌어당겨 한 줄기로 이어집니다.
   - 물줄기는 떨어질수록 빨라져서 가늘어지고(흐르는 양이 같으니 단면적이 줄어듭니다),
     일정 시간이 지나면 출렁임이 커져 끊어지며(레일리-플라토 불안정), 가까운 입자끼리 합쳐져 물방울이 됩니다.
   - 흐름이 약하면 출구에 물방울이 매달려 커지다가, 무게가 표면장력을 이기면 떨어집니다(테이트의 법칙).
   - 각 입자가 어디에 닿는지는 호출하는 쪽이 정합니다(원두 층, 필터 종이, 서버, 작업대 등).
   화면 코드와 분리되어 있어 Node에서도 시험할 수 있습니다. 길이 단위는 cm, 질량 단위는 g입니다. */

(function defineStreamPhysics(globalScope) {
  const GRAVITY_CENTIMETERS_PER_SECOND_SQUARED = 981;
  const WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER = 1;
  const AIR_DRAG_PER_SECOND = 0.6;
  const EMISSION_INTERVAL_SECONDS = 1 / 240;
  const MAXIMUM_STEP_SECONDS = 1 / 240;
  /* 이어진 물줄기 안에서 이웃 입자끼리 옆으로 벌어지지 않게 붙잡는 힘 */
  const COHESION_PER_SECOND = 40;
  /* 끊어지기 시작한 물줄기가 출렁이는 정도 */
  const BREAKUP_WOBBLE_CENTIMETERS_PER_SECOND = 6;
  /* 물방울이 출구에서 떨어지는 무게. 지름 6mm 출구에서 물(표면장력 0.072N/m)일 때 대략 이 정도입니다 */
  const DEFAULT_DROP_DETACH_GRAMS = 0.12;
  const MERGE_LOOKBACK_COUNT = 8;

  function createStreamSimulation(options) {
    const maximumParticles = options.maximumParticles;
    const outletRadiusCentimeters = options.outletRadiusCentimeters;
    const outletArea = Math.PI * outletRadiusCentimeters * outletRadiusCentimeters;
    const jetThresholdGramsPerSecond = options.jetThresholdGramsPerSecond;
    const dropDetachGrams = options.dropDetachGrams || DEFAULT_DROP_DETACH_GRAMS;

    const positionX = new Float32Array(maximumParticles);
    const positionY = new Float32Array(maximumParticles);
    const positionZ = new Float32Array(maximumParticles);
    const velocityX = new Float32Array(maximumParticles);
    const velocityY = new Float32Array(maximumParticles);
    const velocityZ = new Float32Array(maximumParticles);
    const mass = new Float32Array(maximumParticles);
    const age = new Float32Array(maximumParticles);
    const breakupAge = new Float32Array(maximumParticles);
    const flowAtEmission = new Float32Array(maximumParticles);
    const streamIdentifier = new Int32Array(maximumParticles);
    const isAlive = new Uint8Array(maximumParticles);

    let nextParticleIndex = 0;
    let aliveCount = 0;
    let emissionTimer = 0;
    let currentStreamIdentifier = 0;
    let wasFlowing = false;
    let hangingDropGrams = 0;
    let lastFlowGramsPerSecond = 0;

    /* 흐르는 양(g/s)을 출구 넓이로 나누면 물이 나오는 속도(cm/s)가 됩니다 */
    function exitSpeedFor(flowGramsPerSecond) {
      return flowGramsPerSecond / (WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER * outletArea);
    }

    /* 흐름이 셀수록 물줄기가 끊어지지 않고 오래 이어집니다 */
    function breakupAgeFor(flowGramsPerSecond) {
      return 0.08 + 0.03 * flowGramsPerSecond;
    }

    function spawnParticle(origin, direction, speed, particleMass, flowGramsPerSecond) {
      const particleIndex = nextParticleIndex;
      nextParticleIndex = (nextParticleIndex + 1) % maximumParticles;
      if (!isAlive[particleIndex]) {
        aliveCount += 1;
      }
      positionX[particleIndex] = origin.x;
      positionY[particleIndex] = origin.y;
      positionZ[particleIndex] = origin.z;
      velocityX[particleIndex] = direction.x * speed;
      velocityY[particleIndex] = direction.y * speed;
      velocityZ[particleIndex] = direction.z * speed;
      mass[particleIndex] = particleMass;
      age[particleIndex] = 0;
      breakupAge[particleIndex] = breakupAgeFor(flowGramsPerSecond);
      flowAtEmission[particleIndex] = flowGramsPerSecond;
      streamIdentifier[particleIndex] = currentStreamIdentifier;
      isAlive[particleIndex] = 1;
    }

    /* origin: 출구 위치, direction: 출구가 향한 단위 벡터, flowGramsPerSecond: 지금 흐르는 양 */
    function emit(deltaSeconds, origin, direction, flowGramsPerSecond) {
      lastFlowGramsPerSecond = flowGramsPerSecond;
      const isFlowing = flowGramsPerSecond > 0.01;
      if (!isFlowing) {
        if (wasFlowing) {
          currentStreamIdentifier += 1;
        }
        wasFlowing = false;
        emissionTimer = 0;
        return;
      }

      /* 흐름이 약하면 출구에 물방울이 매달려 자라다가 떨어집니다 */
      if (flowGramsPerSecond < jetThresholdGramsPerSecond) {
        if (wasFlowing) {
          currentStreamIdentifier += 1;
          wasFlowing = false;
        }
        hangingDropGrams += flowGramsPerSecond * deltaSeconds;
        if (hangingDropGrams >= dropDetachGrams) {
          spawnParticle(origin, direction, 5, hangingDropGrams, 0);
          breakupAge[(nextParticleIndex + maximumParticles - 1) % maximumParticles] = 0;
          currentStreamIdentifier += 1;
          hangingDropGrams = 0;
        }
        return;
      }

      /* 흐름이 세면 이어진 물줄기로 나옵니다. 매달려 있던 물방울도 함께 쓸려 나갑니다 */
      wasFlowing = true;
      const speed = exitSpeedFor(flowGramsPerSecond);
      emissionTimer += deltaSeconds;
      while (emissionTimer >= EMISSION_INTERVAL_SECONDS) {
        emissionTimer -= EMISSION_INTERVAL_SECONDS;
        const particleMass = flowGramsPerSecond * EMISSION_INTERVAL_SECONDS + hangingDropGrams;
        hangingDropGrams = 0;
        spawnParticle(origin, direction, speed, particleMass, flowGramsPerSecond);
      }
    }

    function previousIndex(particleIndex) {
      return (particleIndex + maximumParticles - 1) % maximumParticles;
    }

    /* 합쳐져서 비어 있는 자리를 건너뛰고, 같은 줄기에서 바로 앞에 나온 살아 있는 입자를 찾습니다 */
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

    function killParticle(particleIndex) {
      if (isAlive[particleIndex]) {
        isAlive[particleIndex] = 0;
        aliveCount -= 1;
      }
    }

    /* 아직 끊어지지 않은 이웃(같은 줄기에서 바로 앞에 나온 입자)과 가로 방향 위치를 맞춥니다 */
    function applyCohesion(particleIndex, stepSeconds) {
      const neighborIndex = previousIndex(particleIndex);
      if (!isAlive[neighborIndex] || streamIdentifier[neighborIndex] !== streamIdentifier[particleIndex]) {
        return;
      }
      if (age[particleIndex] > breakupAge[particleIndex] || age[neighborIndex] > breakupAge[neighborIndex]) {
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

    /* 끊어진 물줄기 조각은 가까운 입자끼리 합쳐져 둥근 물방울이 됩니다 */
    function mergeIntoDrops() {
      for (let particleIndex = 0; particleIndex < maximumParticles; particleIndex += 1) {
        if (!isAlive[particleIndex] || age[particleIndex] <= breakupAge[particleIndex]) {
          continue;
        }
        const neighborIndex = previousAliveInStream(particleIndex);
        if (neighborIndex < 0) {
          continue;
        }
        if (age[neighborIndex] <= breakupAge[neighborIndex]) {
          continue;
        }
        const deltaX = positionX[neighborIndex] - positionX[particleIndex];
        const deltaY = positionY[neighborIndex] - positionY[particleIndex];
        const deltaZ = positionZ[neighborIndex] - positionZ[particleIndex];
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
        const mergeDistance = (dropRadiusFor(mass[particleIndex]) + dropRadiusFor(mass[neighborIndex])) * 1.6;
        if (distance > mergeDistance) {
          continue;
        }
        /* 운동량을 보존하면서 앞의 입자로 합칩니다 */
        const totalMass = mass[particleIndex] + mass[neighborIndex];
        const ownShare = mass[particleIndex] / totalMass;
        const neighborShare = mass[neighborIndex] / totalMass;
        positionX[neighborIndex] = positionX[particleIndex] * ownShare + positionX[neighborIndex] * neighborShare;
        positionY[neighborIndex] = positionY[particleIndex] * ownShare + positionY[neighborIndex] * neighborShare;
        positionZ[neighborIndex] = positionZ[particleIndex] * ownShare + positionZ[neighborIndex] * neighborShare;
        velocityX[neighborIndex] = velocityX[particleIndex] * ownShare + velocityX[neighborIndex] * neighborShare;
        velocityY[neighborIndex] = velocityY[particleIndex] * ownShare + velocityY[neighborIndex] * neighborShare;
        velocityZ[neighborIndex] = velocityZ[particleIndex] * ownShare + velocityZ[neighborIndex] * neighborShare;
        mass[neighborIndex] = totalMass;
        killParticle(particleIndex);
      }
    }

    /* landingTest(입자 번호)가 true를 돌려주면 그 입자는 어딘가에 닿아 사라진 것으로 봅니다 */
    function step(deltaSeconds, landingTest) {
      let remainingSeconds = deltaSeconds;
      while (remainingSeconds > 1e-9) {
        const stepSeconds = Math.min(MAXIMUM_STEP_SECONDS, remainingSeconds);
        remainingSeconds -= stepSeconds;
        const dragFactor = Math.exp(-AIR_DRAG_PER_SECOND * stepSeconds);

        for (let particleIndex = 0; particleIndex < maximumParticles; particleIndex += 1) {
          if (!isAlive[particleIndex]) {
            continue;
          }
          age[particleIndex] += stepSeconds;
          velocityY[particleIndex] -= GRAVITY_CENTIMETERS_PER_SECOND_SQUARED * stepSeconds;
          velocityX[particleIndex] *= dragFactor;
          velocityZ[particleIndex] *= dragFactor;
          if (age[particleIndex] > breakupAge[particleIndex] && breakupAge[particleIndex] > 0) {
            velocityX[particleIndex] += (Math.random() - 0.5) * BREAKUP_WOBBLE_CENTIMETERS_PER_SECOND * stepSeconds * 10;
            velocityZ[particleIndex] += (Math.random() - 0.5) * BREAKUP_WOBBLE_CENTIMETERS_PER_SECOND * stepSeconds * 10;
          }
          applyCohesion(particleIndex, stepSeconds);
          positionX[particleIndex] += velocityX[particleIndex] * stepSeconds;
          positionY[particleIndex] += velocityY[particleIndex] * stepSeconds;
          positionZ[particleIndex] += velocityZ[particleIndex] * stepSeconds;
          if (landingTest(particleIndex)) {
            killParticle(particleIndex);
          }
        }
        mergeIntoDrops();
      }
    }

    function dropRadiusFor(particleMass) {
      return Math.cbrt((3 * particleMass) / (4 * Math.PI * WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER));
    }

    /* 이어진 물줄기의 굵기: 흐르는 양이 같으므로 빨라질수록 가늘어집니다 */
    function streamRadiusAt(particleIndex) {
      const speed = Math.sqrt(
        velocityX[particleIndex] * velocityX[particleIndex] +
        velocityY[particleIndex] * velocityY[particleIndex] +
        velocityZ[particleIndex] * velocityZ[particleIndex]
      );
      const flow = flowAtEmission[particleIndex];
      if (speed < 1e-3 || flow <= 0) {
        return dropRadiusFor(mass[particleIndex]);
      }
      return Math.sqrt(flow / (Math.PI * WATER_DENSITY_GRAMS_PER_CUBIC_CENTIMETER * speed));
    }

    function isIntactStream(particleIndex) {
      return isAlive[particleIndex] && breakupAge[particleIndex] > 0 && age[particleIndex] <= breakupAge[particleIndex];
    }

    /* 화면에 이어진 물줄기를 그릴 수 있도록, 가장 최근 줄기의 끊어지지 않은 입자를 출구 쪽부터 차례로 돌려줍니다 */
    function collectIntactStream(maximumPoints, targetIndexes) {
      let count = 0;
      let particleIndex = previousIndex(nextParticleIndex);
      if (!isIntactStream(particleIndex) || streamIdentifier[particleIndex] !== currentStreamIdentifier) {
        return 0;
      }
      const streamOfInterest = streamIdentifier[particleIndex];
      while (count < maximumPoints && isIntactStream(particleIndex) && streamIdentifier[particleIndex] === streamOfInterest) {
        targetIndexes[count] = particleIndex;
        count += 1;
        particleIndex = previousIndex(particleIndex);
      }
      return count;
    }

    function reset() {
      isAlive.fill(0);
      aliveCount = 0;
      hangingDropGrams = 0;
      emissionTimer = 0;
      wasFlowing = false;
      currentStreamIdentifier += 1;
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
      isAlive: isAlive,
      emit: emit,
      step: step,
      reset: reset,
      exitSpeedFor: exitSpeedFor,
      dropRadiusFor: dropRadiusFor,
      streamRadiusAt: streamRadiusAt,
      isIntactStream: isIntactStream,
      collectIntactStream: collectIntactStream,
      getAliveCount: function getAliveCount() {
        return aliveCount;
      },
      getHangingDropGrams: function getHangingDropGrams() {
        return hangingDropGrams;
      },
      isJetting: function isJetting() {
        return wasFlowing && lastFlowGramsPerSecond >= jetThresholdGramsPerSecond;
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
