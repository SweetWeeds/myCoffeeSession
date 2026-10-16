/* 핸드 그라인더 호퍼 안의 원두 알갱이 물리 근사.
   원두 하나하나를 공으로 보고 중력, 서로 부딪힘, 벽과 깔때기 바닥 충돌을 계산합니다.
   손잡이를 돌리면 가운데 날(버)이 바닥의 원두를 같은 방향으로 끌고 돌며,
   가운데 구멍까지 내려온 원두부터 하나씩 갈려 사라집니다.
   화면 코드와 분리되어 있어 Node에서도 시험할 수 있습니다. */

(function defineGrinderPhysics(globalScope) {
  const GRAVITY = 30;
  const SUBSTEPS = 3;
  const BEAN_RESTITUTION = 0.15;
  const WALL_RESTITUTION = 0.3;
  const FLOOR_FRICTION_PER_SECOND = 6;
  const AIR_DAMPING_PER_SECOND = 0.4;
  /* 날이 바닥 근처 원두를 얼마나 세게 끌고 도는지 */
  const BURR_DRAG_PER_SECOND = 5;
  const BURR_REACH_RADIUS = 1.6;
  const BURR_INWARD_PULL = 0.35;
  const BURR_SWIRL_FRACTION = 0.15;
  /* 갈 원두가 구멍에 없을 때 손잡이를 더 돌려도 미리 쌓아 둘 수 있는 갈기 몫의 최대치 */
  const MAXIMUM_GRIND_BUDGET = 1.5;
  /* 손잡이를 돌리면 그라인더 전체가 떨려서, 벽에 걸린 원두도 조금씩 가운데로 굴러 내려옵니다 */
  const CRANK_VIBRATION_STRENGTH = 0.9;
  const FUNNEL_SLIDE_STRENGTH = 1.2;

  function createGrinderPhysics(options) {
    const beanCount = options.beanCount;
    const beanRadius = options.beanRadius;
    const hopperRadius = options.hopperRadius;
    const floorHeight = options.floorHeight;
    const holeRadius = options.holeRadius;
    const funnelSlope = options.funnelSlope;
    const beansPerRadian = options.beansPerRadian;

    const positions = new Float32Array(beanCount * 3);
    const velocities = new Float32Array(beanCount * 3);
    const spinAngles = new Float32Array(beanCount);
    const isGround = new Uint8Array(beanCount);
    let grindBudget = 0;
    let groundCount = 0;

    /* 처음에는 호퍼 안에 무작위로 쌓아 둡니다 */
    for (let beanIndex = 0; beanIndex < beanCount; beanIndex += 1) {
      const radius = Math.sqrt(Math.random()) * (hopperRadius - beanRadius * 1.2);
      const angle = Math.random() * Math.PI * 2;
      positions[beanIndex * 3] = Math.cos(angle) * radius;
      positions[beanIndex * 3 + 1] = floorHeight + beanRadius * 2 + (beanIndex / beanCount) * beanCount * beanRadius * 0.12 + Math.random() * 0.3;
      positions[beanIndex * 3 + 2] = Math.sin(angle) * radius;
      spinAngles[beanIndex] = Math.random() * Math.PI * 2;
    }

    function floorAt(radius) {
      return floorHeight + Math.max(0, radius - holeRadius) * funnelSlope;
    }

    function resolveBeanCollisions() {
      const minimumDistance = beanRadius * 2;
      const minimumDistanceSquared = minimumDistance * minimumDistance;
      for (let firstIndex = 0; firstIndex < beanCount; firstIndex += 1) {
        if (isGround[firstIndex]) {
          continue;
        }
        const firstOffset = firstIndex * 3;
        for (let secondIndex = firstIndex + 1; secondIndex < beanCount; secondIndex += 1) {
          if (isGround[secondIndex]) {
            continue;
          }
          const secondOffset = secondIndex * 3;
          const deltaX = positions[secondOffset] - positions[firstOffset];
          const deltaY = positions[secondOffset + 1] - positions[firstOffset + 1];
          const deltaZ = positions[secondOffset + 2] - positions[firstOffset + 2];
          const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
          if (distanceSquared >= minimumDistanceSquared || distanceSquared < 1e-8) {
            continue;
          }
          const distance = Math.sqrt(distanceSquared);
          const normalX = deltaX / distance;
          const normalY = deltaY / distance;
          const normalZ = deltaZ / distance;
          const overlap = minimumDistance - distance;

          /* 겹친 만큼 반씩 밀어냅니다 */
          positions[firstOffset] -= normalX * overlap * 0.5;
          positions[firstOffset + 1] -= normalY * overlap * 0.5;
          positions[firstOffset + 2] -= normalZ * overlap * 0.5;
          positions[secondOffset] += normalX * overlap * 0.5;
          positions[secondOffset + 1] += normalY * overlap * 0.5;
          positions[secondOffset + 2] += normalZ * overlap * 0.5;

          /* 서로 다가오는 속도만 튕겨 냅니다 */
          const relativeVelocity =
            (velocities[secondOffset] - velocities[firstOffset]) * normalX +
            (velocities[secondOffset + 1] - velocities[firstOffset + 1]) * normalY +
            (velocities[secondOffset + 2] - velocities[firstOffset + 2]) * normalZ;
          if (relativeVelocity < 0) {
            const impulse = (-(1 + BEAN_RESTITUTION) * relativeVelocity) / 2;
            velocities[firstOffset] -= impulse * normalX;
            velocities[firstOffset + 1] -= impulse * normalY;
            velocities[firstOffset + 2] -= impulse * normalZ;
            velocities[secondOffset] += impulse * normalX;
            velocities[secondOffset + 1] += impulse * normalY;
            velocities[secondOffset + 2] += impulse * normalZ;
          }
        }
      }
    }

    function resolveContainer(beanIndex, stepSeconds) {
      const offset = beanIndex * 3;
      const positionX = positions[offset];
      const positionZ = positions[offset + 2];
      const radius = Math.sqrt(positionX * positionX + positionZ * positionZ);
      const maximumRadius = hopperRadius - beanRadius;

      if (radius > maximumRadius) {
        const normalX = positionX / radius;
        const normalZ = positionZ / radius;
        positions[offset] = normalX * maximumRadius;
        positions[offset + 2] = normalZ * maximumRadius;
        const outwardVelocity = velocities[offset] * normalX + velocities[offset + 2] * normalZ;
        if (outwardVelocity > 0) {
          velocities[offset] -= (1 + WALL_RESTITUTION) * outwardVelocity * normalX;
          velocities[offset + 2] -= (1 + WALL_RESTITUTION) * outwardVelocity * normalZ;
        }
      }

      const restingHeight = floorAt(Math.min(radius, maximumRadius)) + beanRadius;
      if (positions[offset + 1] < restingHeight) {
        positions[offset + 1] = restingHeight;
        if (velocities[offset + 1] < 0) {
          velocities[offset + 1] *= -WALL_RESTITUTION;
        }
        /* 깔때기 바닥에서는 마찰로 느려지고, 경사를 따라 가운데로 미끄러집니다 */
        const frictionFactor = Math.exp(-FLOOR_FRICTION_PER_SECOND * stepSeconds);
        velocities[offset] *= frictionFactor;
        velocities[offset + 2] *= frictionFactor;
        if (radius > holeRadius && radius > 1e-6) {
          const slideAcceleration = GRAVITY * funnelSlope * FUNNEL_SLIDE_STRENGTH * stepSeconds;
          velocities[offset] -= (positionX / radius) * slideAcceleration;
          velocities[offset + 2] -= (positionZ / radius) * slideAcceleration;
        }
      }
    }

    function applyBurrDrag(beanIndex, burrAngularVelocity, stepSeconds) {
      const offset = beanIndex * 3;
      const positionX = positions[offset];
      const positionZ = positions[offset + 2];
      const radius = Math.sqrt(positionX * positionX + positionZ * positionZ);
      const isNearBurr = radius < BURR_REACH_RADIUS && positions[offset + 1] < floorAt(radius) + beanRadius * 3;
      if (!isNearBurr) {
        return;
      }
      /* 날의 회전 속도에 맞춰 원두가 둘레 방향으로 끌려갑니다 */
      const tangentX = -positionZ;
      const tangentZ = positionX;
      const blend = Math.min(1, BURR_DRAG_PER_SECOND * stepSeconds);
      /* 둘레 방향으로 끌면서 동시에 날 쪽(가운데 아래)으로 빨아들입니다. 그래야 원두가 고리 모양으로 맴돌지 않습니다 */
      const inwardSpeed = Math.abs(burrAngularVelocity) * BURR_INWARD_PULL;
      const targetVelocityX = tangentX * burrAngularVelocity * BURR_SWIRL_FRACTION - positionX * inwardSpeed;
      const targetVelocityZ = tangentZ * burrAngularVelocity * BURR_SWIRL_FRACTION - positionZ * inwardSpeed;
      velocities[offset] += (targetVelocityX - velocities[offset]) * blend * 0.5;
      velocities[offset + 2] += (targetVelocityZ - velocities[offset + 2]) * blend * 0.5;
      velocities[offset + 1] += Math.abs(burrAngularVelocity) * 0.04 * Math.random();
    }

    function applyCrankVibration(beanIndex, burrAngularVelocity, stepSeconds) {
      if (burrAngularVelocity <= 0) {
        return;
      }
      const offset = beanIndex * 3;
      const kick = CRANK_VIBRATION_STRENGTH * Math.min(1, burrAngularVelocity / 6) * stepSeconds * 60;
      velocities[offset] += (Math.random() - 0.5) * kick * 0.3 - positions[offset] * kick * 0.05;
      velocities[offset + 2] += (Math.random() - 0.5) * kick * 0.3 - positions[offset + 2] * kick * 0.05;
      velocities[offset + 1] += Math.random() * kick * 0.15;
    }

    /* 구멍 가까이 내려온 원두부터 하나씩 갈아 냅니다 */
    function grindBeansAtHole() {
      let groundThisStep = 0;
      while (grindBudget >= 1) {
        let closestIndex = -1;
        let closestScore = Infinity;
        for (let beanIndex = 0; beanIndex < beanCount; beanIndex += 1) {
          if (isGround[beanIndex]) {
            continue;
          }
          const offset = beanIndex * 3;
          const radius = Math.hypot(positions[offset], positions[offset + 2]);
          const heightAboveFloor = positions[offset + 1] - floorHeight;
          if (radius > holeRadius + beanRadius || heightAboveFloor > beanRadius * 2.5) {
            continue;
          }
          const score = radius + heightAboveFloor;
          if (score < closestScore) {
            closestScore = score;
            closestIndex = beanIndex;
          }
        }
        if (closestIndex < 0) {
          break;
        }
        isGround[closestIndex] = 1;
        groundCount += 1;
        groundThisStep += 1;
        grindBudget -= 1;
      }
      grindBudget = Math.min(grindBudget, MAXIMUM_GRIND_BUDGET);
      return groundThisStep;
    }

    /* burrAngularVelocity: 손잡이가 도는 속도(라디안/초). 시계 방향(양수)일 때만 갈립니다 */
    function step(deltaSeconds, burrAngularVelocity) {
      const stepSeconds = deltaSeconds / SUBSTEPS;
      let groundThisStep = 0;
      if (burrAngularVelocity > 0) {
        grindBudget += burrAngularVelocity * deltaSeconds * beansPerRadian;
      }

      for (let substepIndex = 0; substepIndex < SUBSTEPS; substepIndex += 1) {
        const dampingFactor = Math.exp(-AIR_DAMPING_PER_SECOND * stepSeconds);
        for (let beanIndex = 0; beanIndex < beanCount; beanIndex += 1) {
          if (isGround[beanIndex]) {
            continue;
          }
          const offset = beanIndex * 3;
          velocities[offset + 1] -= GRAVITY * stepSeconds;
          applyBurrDrag(beanIndex, burrAngularVelocity, stepSeconds);
          applyCrankVibration(beanIndex, burrAngularVelocity, stepSeconds);
          velocities[offset] *= dampingFactor;
          velocities[offset + 1] *= dampingFactor;
          velocities[offset + 2] *= dampingFactor;
          positions[offset] += velocities[offset] * stepSeconds;
          positions[offset + 1] += velocities[offset + 1] * stepSeconds;
          positions[offset + 2] += velocities[offset + 2] * stepSeconds;
          spinAngles[beanIndex] += Math.hypot(velocities[offset], velocities[offset + 2]) * stepSeconds / beanRadius;
        }
        resolveBeanCollisions();
        for (let beanIndex = 0; beanIndex < beanCount; beanIndex += 1) {
          if (!isGround[beanIndex]) {
            resolveContainer(beanIndex, stepSeconds);
          }
        }
      }

      groundThisStep += grindBeansAtHole();
      return groundThisStep;
    }

    /* 손으로 조금씩 돌리는 대신 남은 원두를 한꺼번에 갈 때 씁니다 */
    function grindAllRemaining() {
      let groundNow = 0;
      for (let beanIndex = 0; beanIndex < beanCount; beanIndex += 1) {
        if (!isGround[beanIndex]) {
          isGround[beanIndex] = 1;
          groundNow += 1;
        }
      }
      groundCount += groundNow;
      return groundNow;
    }

    return {
      beanCount: beanCount,
      positions: positions,
      spinAngles: spinAngles,
      isGround: isGround,
      step: step,
      grindAllRemaining: grindAllRemaining,
      getGroundCount: function getGroundCount() {
        return groundCount;
      }
    };
  }

  const GrinderPhysics = { createGrinderPhysics: createGrinderPhysics };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = GrinderPhysics;
  } else {
    globalScope.CoffeeSession = globalScope.CoffeeSession || {};
    globalScope.CoffeeSession.GrinderPhysics = GrinderPhysics;
  }
})(typeof window !== "undefined" ? window : globalThis);
