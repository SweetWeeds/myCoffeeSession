/* 3D 드립 시뮬레이터 화면.
   작업대 위에 그라인더, 가루 통, 드리퍼, 주전자가 있고, 사용자는 도구를 골라 원하는 순서로 한 잔을 내립니다.
   계산은 세 개의 모델이 맡습니다.
   - grinder-physics.js: 호퍼 안 원두 알갱이의 충돌과 갈림
   - fluid-brew-model.js: 원두 층 위 물의 퍼짐, 침투, 추출, 점수
   - paper-wetting-model.js: 필터 종이가 젖고 번지는 모습
   이 파일은 3D 장면, 입력 처리, 화면 갱신을 맡습니다. */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const CoffeeSession = window.CoffeeSession;
const FluidBrewModel = CoffeeSession.FluidBrewModel;
const PaperWettingModel = CoffeeSession.PaperWettingModel;
const GrinderPhysics = CoffeeSession.GrinderPhysics;
const StreamPhysics = CoffeeSession.StreamPhysics;

/* ---------- 상수 ---------- */

const MAXIMUM_FRAME_SECONDS = 0.05;
const TIMELINE_SAMPLE_SECONDS = 0.25;
const TIMELINE_MINIMUM_SECONDS = 210;
const HISTORY_STORAGE_KEY = "coffee-session-brew-history";
const MAXIMUM_HISTORY_ENTRIES = 8;
const BASIC_RECIPE_OPTION_VALUE = "basic";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FULL_TURN_RADIANS = Math.PI * 2;
const PRIMARY_MOUSE_BUTTON = 0;
const DISABLED_CONTROL_ACTION = -1;
const TEXT_REFRESH_FRAME_INTERVAL = 6;

/* 작업대 배치 (단위는 대략 cm) */
const TABLE_HEIGHT = -7.4;
const CONE_BOTTOM_RADIUS = 0.7;
const CONE_TOP_RADIUS = 6.0;
const CONE_HEIGHT = 7.2;
const PAPER_TOP_HEIGHT = 7.9;
const BED_FLOOR_Y = 1.4;
const BED_MILLIMETER_TO_WORLD = 0.08;
const WATER_MILLIMETER_TO_WORLD = 0.04;
const HIDDEN_WATER_THRESHOLD_MILLIMETERS = 0.05;
const SERVER_CAPACITY_GRAMS = 400;
const SERVER_INNER_HEIGHT = 5.4;
/* 주전자를 들었을 때(높이 11)부터 서버 바닥까지 한 화면에 들어오도록 드리퍼보다 조금 위를 바라봅니다 */
const DRIPPER_FOCUS = new THREE.Vector3(0, 4.5, 0);

/* 그라인더: 아래는 유리 가루 통, 가운데는 날이 든 몸통, 위는 원두가 보이는 유리 호퍼 */
const GRINDER_POSITION = new THREE.Vector3(-12, 0, -1);
const JAR_RADIUS = 1.55;
const JAR_HEIGHT = 3.6;
const JAR_BOTTOM_Y = TABLE_HEIGHT + 0.1;
const BURR_HOUSING_TOP_Y = 0.6;
const HOPPER_FLOOR_Y = 0.6;
const HOPPER_RADIUS = 1.95;
const HOPPER_HEIGHT = 2.6;
const CRANK_HEIGHT = 3.8;
const BEAN_RADIUS = 0.24;
const BEAN_HOLE_RADIUS = 0.5;
const FUNNEL_SLOPE = 0.5;
const GRAMS_PER_BEAN = 0.14;
const MAXIMUM_BEAN_COUNT = 180;
const ROTATIONS_PER_GRAM = 0.6;
const GRINDER_FOCUS = new THREE.Vector3(GRINDER_POSITION.x, 0.5, GRINDER_POSITION.z);

/* 원두 갈기 속도와 미분 */
const COMFORTABLE_CRANK_SPEED_ROTATIONS_PER_SECOND = 1.6;
const BASE_FINES_FRACTION = 0.07;
const FINES_PER_EXTRA_ROTATION_SPEED = 0.06;
const MAXIMUM_FINES_FRACTION = 0.3;
const AUTOMATIC_CRANK_SPEED_ROTATIONS_PER_SECOND = 1.3;
const AUTOMATIC_GRIND_TIMEOUT_SECONDS = 25;
const CRANK_SPEED_SMOOTHING = 0.25;
const CRANK_IDLE_SECONDS = 0.1;

/* 가루 통과 가루 알갱이 */
const JAR_POUR_HEIGHT = 10.5;
const GROUNDS_POUR_RATE_GRAMS_PER_SECOND = 7;
const JAR_GRAIN_CAPACITY = 700;
const BED_GRAIN_COUNT = 2200;
const FALLING_PARTICLE_COUNT = 700;
const FALLING_PARTICLES_PER_BEAN = 10;
const SHAKE_MINIMUM_TRAVEL = 0.5;

/* 주전자와 물 */
/* 주전자 몸통 가운데 높이. 몸통 아랫면이 드리퍼 테두리보다 조금 위에 오도록 잡았습니다 */
const KETTLE_BODY_HEIGHT = 11;
const KETTLE_PARKED_BODY = new THREE.Vector3(10, TABLE_HEIGHT + 1.7, 5);
const KETTLE_TILT_SECONDS = 0.35;
/* 주전자는 손으로 옮기는 정도의 속도로만 포인터를 따라갑니다 */
const KETTLE_MAXIMUM_SPEED_CENTIMETERS_PER_SECOND = 40;
const KETTLE_FOLLOW_STIFFNESS_PER_SECOND = 12;
/* 시점을 돌리면 주전자도 따라 돌아, 화면에서 언제나 주둥이가 왼쪽을 향하게 합니다.
   한 번에 휙 돌면 주둥이가 빠르게 움직여 물줄기가 흩날리므로 손으로 돌리는 빠르기로 제한합니다 */
const KETTLE_TURN_SPEED_RADIANS_PER_SECOND = 2.5;
/* 물이 부딪히는 주전자 몸통의 크기(모델 기준 반지름과 위아래 범위) */
const KETTLE_BODY_COLLISION_RADIUS = 2.25;
const KETTLE_BODY_COLLISION_BOTTOM = -1.7;
const KETTLE_BODY_COLLISION_TOP = 2.2;
const KETTLE_FLOW_START_TILT = 0.45;
const KETTLE_MAXIMUM_TILT_RADIANS = { gentle: 0.3, normal: 0.4, strong: 0.52 };
/* 드립 주전자 주둥이 구멍 반지름(지름 약 4.4mm). 물이 나오는 속도와 처음 물줄기 굵기를 정합니다 */
const SPOUT_OUTLET_RADIUS = 0.22;
const KETTLE_JET_THRESHOLD_GRAMS_PER_SECOND = 0.6;
const KETTLE_STREAM_MAXIMUM_PARTICLES = 900;
const BUBBLE_COUNT = 320;
const AUTOMATIC_POUR_ANGULAR_SPEED = 2.6;
const PAPER_DIRECT_HIT_WETNESS_PER_GRAM = 0.08;

/* 드리퍼 바닥 구멍과 그 아래로 떨어지는 커피 */
const DRIPPER_OUTLET_HEIGHT = -0.45;
const DRIPPER_OUTLET_RADIUS = 0.2;
const DRIP_JET_THRESHOLD_GRAMS_PER_SECOND = 1.5;
const DRIP_STREAM_MAXIMUM_PARTICLES = 500;

/* 물줄기 그리기: 실제 굵기(1mm 안팎)로는 화면에서 잘 안 보여 조금 굵게 그립니다 */
const STREAM_VISUAL_SCALE = 1.25;
const STREAM_TUBE_MAXIMUM_POINTS = 90;
const STREAM_TUBE_SUBDIVISIONS = 5;
const STREAM_TUBE_SIDES = 12;
/* 물줄기로 이어 그리는 이웃 입자 사이의 최대 거리. 실제 물줄기에서 이웃 입자는 1cm 안쪽에 있으므로,
   이보다 멀리 떨어진 입자는 이어진 물줄기가 아니라 따로 떨어지는 물방울로 그립니다 */
const STREAM_MAXIMUM_LINK_CENTIMETERS = 1.5;
const RIPPLE_COUNT = 24;
const RIPPLE_SPAWN_INTERVAL_SECONDS = 0.05;
const RIPPLE_LIFETIME_SECONDS = 0.7;
const SPLASH_PARTICLE_COUNT = 240;
/* 물결 고리는 액체 색에 흰 반사광을 이만큼 섞어 그립니다 */
const RIPPLE_HIGHLIGHT_WHITENESS = 0.6;

/* 커피 색: 녹아 있는 성분이 빛을 흡수하는 정도(비어-람베르트 법칙)로 정합니다.
   파란빛이 가장 많이, 빨간빛이 가장 적게 흡수되어 옅으면 호박색, 진하면 검은 갈색이 됩니다.
   값은 농도 1%인 커피를 1cm 두께로 지날 때 빛이 줄어드는 정도(빨강, 초록, 파랑)입니다 */
const COFFEE_ABSORPTION_PER_PERCENT_CENTIMETER = { red: 1.0, green: 1.6, blue: 2.4 };
/* 같은 커피라도 눈에 보이는 두께가 달라 진하기가 다르게 보입니다: 가는 물줄기 < 드리퍼에 고인 물 < 서버 */
const STREAM_VIEW_DEPTH_CENTIMETERS = 1.0;
const BED_LIQUID_VIEW_DEPTH_CENTIMETERS = 1.2;
const SERVER_VIEW_DEPTH_CENTIMETERS = 3.0;
/* 화면의 커피 색이 갑자기 바뀌지 않도록 농도 변화를 이 시간에 걸쳐 따라갑니다.
   서버 쪽은 새 물을 부을 때마다 계산상 농도가 출렁여서 더 천천히 따라가게 합니다 */
const STREAM_COLOR_FOLLOW_SECONDS = 0.5;
const SERVER_COLOR_FOLLOW_SECONDS = 3;
/* 투과 정도: 맑은 물은 많이 비치고 진한 커피는 거의 비치지 않습니다 */
const CLEAR_WATER_TRANSMISSION = 0.55;
const STRONG_COFFEE_STREAM_TRANSMISSION = 0.3;
const CLEAR_WATER_SURFACE_OPACITY = 0.3;
const STRONG_COFFEE_SURFACE_OPACITY = 0.85;

/* 필터 종이 격자 */
const PAPER_ANGLE_SEGMENTS = 72;
const PAPER_HEIGHT_ROWS = 28;
const PAPER_CONTACT_SAMPLE_RADIUS = 0.92;
/* 종이는 조금만 젖어도 눈에 띄게 어두워지고 비쳐 보여서, 젖은 곳과 마른 곳 사이에 뚜렷한 경계선이 생깁니다.
   젖음이 이 값 이상이면 완전히 젖은 색으로 그립니다 */
const PAPER_WETNESS_FOR_FULL_DARKENING = 0.4;

const CAMERA_OFFSETS = {
  angled: new THREE.Vector3(0, 17, 21.5),
  top: new THREE.Vector3(0, 27, 0.01),
  side: new THREE.Vector3(0, 3, 28)
};
const CAMERA_ANIMATION_SECONDS = 0.6;

const COLORS = {
  paper: new THREE.Color(0xf3efe6),
  /* 젖은 종이는 어두워지고 반쯤 비쳐서 뒤에 있는 빨간 드리퍼 색이 살짝 배어 보입니다 */
  wetPaper: new THREE.Color(0xae8f88),
  clearWater: new THREE.Color(0xa9c4d8),
  stainedPaper: new THREE.Color(0x8a5a35),
  dryGrounds: new THREE.Color(0xb48a62),
  wetGrounds: new THREE.Color(0x4b2d1d),
  bloomFoam: new THREE.Color(0xc9a074),
  underExtracted: new THREE.Color(0x3b6fb6),
  idealExtracted: new THREE.Color(0x3f9a5a),
  overExtracted: new THREE.Color(0xc0392b),
  dripperCeramic: new THREE.Color(0xa3242b)
};

const TOOL_HINTS = {
  grind: "그라인더 위에서 누른 채 시계 방향으로 원을 그리세요. 원두가 서로 부딪히며 가운데 날로 빨려 들어갑니다.",
  grounds: "가루 통을 드리퍼 위로 끌고 가서 누르고 있으면 가루가 쏟아집니다.",
  shake: "누른 채 좌우로 빠르게 끌면 드리퍼를 흔들어 원두 층을 평평하게 합니다.",
  water: "포인터로 주전자를 잡고 움직이세요. 누르고 있으면 주전자가 기울어 물줄기가 나옵니다. 물이 떨어지는 곳을 보며 원을 그리고, 첫 물은 원두의 2–3배만 부어 30–45초 뜸을 들이세요.",
  camera: "끌어서 시점을 돌리고, 휠이나 두 손가락으로 확대·축소하세요."
};

/* ---------- 화면 요소 ---------- */

function getElement(elementId) {
  return document.getElementById(elementId);
}

const viewport = getElement("three-viewport");
const stageInstruction = getElement("stage-instruction");
const toolSelector = getElement("tool-selector");
const viewSelector = getElement("view-selector");
const webglFallback = getElement("webgl-fallback");
const checklist = getElement("brew-checklist");

const beanSelect = getElement("bean-select");
const beanHint = getElement("bean-hint");
const doseInput = getElement("dose-input");
const ratioInput = getElement("ratio-input");
const grindInput = getElement("grind-input");
const temperatureInput = getElement("temperature-input");
const doseValue = getElement("dose-value");
const ratioValue = getElement("ratio-value");
const grindValue = getElement("grind-value");
const grindHint = getElement("grind-hint");
const temperatureValue = getElement("temperature-value");
const pourRateSelector = getElement("pour-rate-selector");
const speedSelector = getElement("speed-selector");

const finishButton = getElement("finish-button");
const automaticGrindButton = getElement("automatic-grind-button");
const automaticLoadButton = getElement("automatic-load-button");
const automaticPourButton = getElement("automatic-pour-button");
const resetButton = getElement("reset-button");

const scaleTime = getElement("scale-time");
const scaleWeight = getElement("scale-weight");
const scaleBeverage = getElement("scale-beverage");
const scaleTarget = getElement("scale-target");
const pourTimeline = getElement("pour-timeline");

const resultPanel = getElement("result-panel");
const resultScore = getElement("result-score");
const resultReview = getElement("result-review");
const scoreBreakdown = getElement("score-breakdown");
const resultVerdict = getElement("result-verdict");
const resultTime = getElement("result-time");
const resultBeverage = getElement("result-beverage");
const resultExtraction = getElement("result-extraction");
const resultStrength = getElement("result-strength");
const resultUniformity = getElement("result-uniformity");
const resultBypass = getElement("result-bypass");
const resultAdvice = getElement("result-advice");
const heatmapButton = getElement("heatmap-button");
const heatmapLegend = getElement("heatmap-legend");
const brewChart = getElement("brew-chart");
const sendToTastingLink = getElement("send-to-tasting");
const brewAgainButton = getElement("brew-again-button");
const historyList = getElement("history-list");
const historyEmpty = getElement("history-empty");

const lockableControls = [beanSelect, doseInput, ratioInput, grindInput, temperatureInput];

/* ---------- 상태 ---------- */

let selectedTool = "grind";
let selectedPourRate = "normal";
let selectedSpeed = 2;
let sceneClockSeconds = 0;

let brewModel = null;
let paperModel = null;
let grinderPhysics = null;
let lastResult = null;
let brewHistory = readHistory();
let isHeatmapVisible = false;
let areSettingsLocked = false;

const grindState = {
  beanCount: 0,
  gramsPerBean: GRAMS_PER_BEAN,
  groundGrams: 0,
  finesWeightedSum: 0,
  crankAngle: 0,
  previousPointerAngle: null,
  previousPointerSecond: 0,
  crankAngularVelocity: 0,
  pointerAngularVelocity: 0,
  isAutomatic: false,
  automaticStartSecond: 0
};

const jarState = {
  grams: 0,
  pointerX: 0,
  pointerZ: 0
};

const shakeState = {
  direction: 0,
  travel: 0,
  previousX: null,
  dripperJiggle: 0
};

const pourState = {
  isPointerPouring: false,
  isKeyboardPouring: false,
  isAutomaticRunning: false,
  kettleTargetX: 3,
  kettleTargetZ: 2,
  tiltProgress: 0,
  automaticAngle: 0,
  timelinePoints: [{ second: 0, grams: 0 }],
  nextTimelineSampleSecond: TIMELINE_SAMPLE_SECONDS
};

const dripState = {
  emittedGrams: 0,
  landedGrams: 0
};

/* 화면에 보이는 커피 농도(%). 물만 있으면 0이라 물 색으로 보입니다 */
const liquidColorState = {
  streamStrengthPercent: 0,
  serverStrengthPercent: 0,
  previousPercolatedGrams: 0,
  previousBypassGrams: 0
};

const activePointerIds = new Set();
let isPrimaryPointerDown = false;

/* ---------- 유틸리티 ---------- */

function formatClock(totalSeconds) {
  const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}

function parseClock(clockText) {
  const parts = clockText.trim().split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function readHistory() {
  try {
    const savedText = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!savedText) {
      return [];
    }
    const parsedHistory = JSON.parse(savedText);
    if (Array.isArray(parsedHistory)) {
      return parsedHistory;
    }
    return [];
  } catch (storageError) {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(brewHistory));
  } catch (storageError) {
    /* 저장할 수 없는 환경에서도 현재 화면의 기록은 유지됩니다 */
  }
}

function createSvgElement(tagName, attributes, textContent) {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);
  Object.keys(attributes).forEach(function setAttribute(attributeName) {
    element.setAttribute(attributeName, attributes[attributeName]);
  });
  if (textContent !== undefined) {
    element.textContent = textContent;
  }
  return element;
}

function readCssColor(variableName) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return new THREE.Color(value || "#888888");
}

function coneRadiusAt(height) {
  return CONE_BOTTOM_RADIUS + ((CONE_TOP_RADIUS - CONE_BOTTOM_RADIUS) * height) / CONE_HEIGHT;
}

function coneHeightAtRadius(radius) {
  return ((radius - CONE_BOTTOM_RADIUS) / (CONE_TOP_RADIUS - CONE_BOTTOM_RADIUS)) * CONE_HEIGHT;
}

function isBrewFinished() {
  return brewModel !== null && brewModel.state.phase === "finished";
}

/* ---------- 설정 ---------- */

function getSelectedBean() {
  if (beanSelect.value === BASIC_RECIPE_OPTION_VALUE) {
    return null;
  }
  return CoffeeSession.findBeanById(beanSelect.value) || null;
}

function getSelectedRecipe() {
  const selectedBean = getSelectedBean();
  if (selectedBean) {
    return selectedBean.recipe;
  }
  return CoffeeSession.basicRecipe;
}

function readSettings() {
  const selectedBean = getSelectedBean();
  let beanExtractionOffset = 0;
  if (selectedBean) {
    beanExtractionOffset = selectedBean.extractionOffset;
  }
  return {
    doseGrams: Number(doseInput.value),
    ratio: Number(ratioInput.value),
    grindSetting: Number(grindInput.value),
    temperatureCelsius: Number(temperatureInput.value),
    beanExtractionOffset: beanExtractionOffset
  };
}

/* 레시피의 물 양을 현재 설정한 원두 양과 비율에 맞춰 늘리거나 줄입니다 */
function getScaledSchedule() {
  const recipe = getSelectedRecipe();
  const recipeWaterGrams = recipe.doseGrams * recipe.ratio;
  const settings = readSettings();
  const scaleFactor = (settings.doseGrams * settings.ratio) / recipeWaterGrams;
  return recipe.schedule.map(function scaleStep(step) {
    return {
      atSecond: step.atSecond,
      cumulativeGrams: Math.round(step.cumulativeGrams * scaleFactor),
      label: step.label
    };
  });
}

function getTargetTimeRange() {
  const rangeParts = getSelectedRecipe().targetTimeText.split("–");
  return { targetLowSeconds: parseClock(rangeParts[0]), targetHighSeconds: parseClock(rangeParts[1]) };
}

function populateBeanSelect() {
  const basicOption = document.createElement("option");
  basicOption.value = BASIC_RECIPE_OPTION_VALUE;
  basicOption.textContent = "입문용 기본 레시피";
  beanSelect.appendChild(basicOption);

  CoffeeSession.beans.forEach(function addBeanOption(bean) {
    const option = document.createElement("option");
    option.value = bean.id;
    option.textContent = bean.koreanName;
    beanSelect.appendChild(option);
  });

  const requestedBeanId = new URLSearchParams(window.location.search).get("bean");
  if (requestedBeanId && CoffeeSession.findBeanById(requestedBeanId)) {
    beanSelect.value = requestedBeanId;
  }
}

function applySelectedRecipe() {
  const recipe = getSelectedRecipe();
  doseInput.value = recipe.doseGrams;
  ratioInput.value = recipe.ratio;
  grindInput.value = recipe.grindSetting;
  temperatureInput.value = recipe.temperatureCelsius;
  beanHint.textContent =
    "추천: " + recipe.temperatureCelsius + "°C, 1:" + recipe.ratio + ", 분쇄 " + recipe.grindSetting +
    "단계, 총 " + recipe.targetTimeText;
}

function updateSettingLabels() {
  const settings = readSettings();
  doseValue.textContent = settings.doseGrams + "g";
  ratioValue.textContent = "1:" + settings.ratio + " (물 " + Math.round(settings.doseGrams * settings.ratio) + "g)";
  grindValue.textContent = settings.grindSetting + "단계";
  grindHint.textContent = CoffeeSession.describeGrindSetting(settings.grindSetting);
  temperatureValue.textContent = settings.temperatureCelsius + "°C";
}

function lockSettings() {
  if (areSettingsLocked) {
    return;
  }
  areSettingsLocked = true;
  lockableControls.forEach(function disableControl(control) {
    control.disabled = true;
  });
}

function unlockSettings() {
  areSettingsLocked = false;
  lockableControls.forEach(function enableControl(control) {
    control.disabled = false;
  });
}

function markSegmentPressed(container, pressedButton) {
  container.querySelectorAll("button").forEach(function updatePressed(button) {
    button.setAttribute("aria-pressed", String(button === pressedButton));
  });
}

function setUpSegmentedControl(container, dataKey, onSelect) {
  container.addEventListener("click", function handleSegmentClick(event) {
    const clickedButton = event.target.closest("button");
    if (!clickedButton || clickedButton.disabled) {
      return;
    }
    markSegmentPressed(container, clickedButton);
    onSelect(clickedButton.dataset[dataKey]);
  });
}

/* ---------- 3D 장면 준비 ---------- */

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (rendererError) {
  renderer = null;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
camera.position.copy(GRINDER_FOCUS).add(CAMERA_OFFSETS.angled);
camera.lookAt(GRINDER_FOCUS);

let orbitControls = null;
if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  /* 투명한 물이 주변을 비추고 굴절해 보이도록 방 안 조명을 흉내 낸 환경 빛을 씁니다 */
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  viewport.prepend(renderer.domElement);
  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target.copy(GRINDER_FOCUS);
  orbitControls.enableDamping = true;
  orbitControls.minDistance = 7;
  orbitControls.maxDistance = 45;
  orbitControls.maxPolarAngle = Math.PI * 0.49;
  orbitControls.enablePan = false;
} else {
  webglFallback.hidden = false;
}

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.15));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.position.set(7, 16, 9);
scene.add(sunLight);

const tableMaterial = new THREE.MeshStandardMaterial({ color: 0xdedbd4, roughness: 0.95 });
const table = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), tableMaterial);
table.rotation.x = -Math.PI / 2;
table.position.y = TABLE_HEIGHT;
scene.add(table);

function applySceneTheme() {
  scene.background = readCssColor("--color-surface-muted");
  tableMaterial.color = readCssColor("--color-border");
}
applySceneTheme();

const steelMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.65, roughness: 0.3 });
const darkMetalMaterial = new THREE.MeshStandardMaterial({ color: 0x2f2f33, metalness: 0.4, roughness: 0.45 });
const darkHandleMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });
const glassMaterial = new THREE.MeshStandardMaterial({
  color: 0xdfe8ee,
  transparent: true,
  opacity: 0.2,
  roughness: 0.05,
  side: THREE.DoubleSide,
  depthWrite: false
});

/* ---------- 드리퍼, 필터 종이, 서버 ---------- */

const dripperGroup = new THREE.Group();
scene.add(dripperGroup);

function createConeLathe(bottomRadius, bottomHeight, topRadius, topHeight) {
  const profilePoints = [];
  const profileSegments = 24;
  for (let segmentIndex = 0; segmentIndex <= profileSegments; segmentIndex += 1) {
    const fraction = segmentIndex / profileSegments;
    profilePoints.push(
      new THREE.Vector2(bottomRadius + (topRadius - bottomRadius) * fraction, bottomHeight + (topHeight - bottomHeight) * fraction)
    );
  }
  return new THREE.LatheGeometry(profilePoints, 96);
}

const ceramicMaterial = new THREE.MeshStandardMaterial({ color: COLORS.dripperCeramic, roughness: 0.35, side: THREE.DoubleSide });
dripperGroup.add(new THREE.Mesh(createConeLathe(1.1, -0.4, CONE_TOP_RADIUS + 0.45, CONE_HEIGHT), ceramicMaterial));

const flange = new THREE.Mesh(new THREE.RingGeometry(CONE_TOP_RADIUS + 0.3, CONE_TOP_RADIUS + 1.8, 72), ceramicMaterial);
flange.rotation.x = -Math.PI / 2;
flange.position.y = CONE_HEIGHT - 0.05;
dripperGroup.add(flange);

const rimEdge = new THREE.Mesh(new THREE.TorusGeometry(CONE_TOP_RADIUS + 0.4, 0.14, 12, 96), ceramicMaterial);
rimEdge.rotation.x = Math.PI / 2;
rimEdge.position.y = CONE_HEIGHT;
dripperGroup.add(rimEdge);

const dripperHandle = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.4), ceramicMaterial);
dripperHandle.position.set(CONE_TOP_RADIUS + 2.6, CONE_HEIGHT - 0.6, 0);
dripperGroup.add(dripperHandle);

/* 필터 종이: 젖음 모델과 같은 (각도 × 높이) 격자로 만들어 칸마다 색을 바꿉니다 */
const paperColumnCount = PAPER_ANGLE_SEGMENTS + 1;
const paperVertexCount = paperColumnCount * PAPER_HEIGHT_ROWS;
const paperPositions = new Float32Array(paperVertexCount * 3);
const paperColors = new Float32Array(paperVertexCount * 3);
const paperRowHeight = PAPER_TOP_HEIGHT / (PAPER_HEIGHT_ROWS - 1);
for (let rowIndex = 0; rowIndex < PAPER_HEIGHT_ROWS; rowIndex += 1) {
  for (let columnIndex = 0; columnIndex < paperColumnCount; columnIndex += 1) {
    const vertexIndex = rowIndex * paperColumnCount + columnIndex;
    const angle = (columnIndex / PAPER_ANGLE_SEGMENTS) * FULL_TURN_RADIANS;
    const height = rowIndex * paperRowHeight;
    /* 종이 주름을 흉내 내려고 둘레를 따라 반지름을 살짝 물결치게 합니다 */
    const radius = (coneRadiusAt(height) - 0.02) * (1 + 0.012 * Math.sin(angle * 14));
    paperPositions[vertexIndex * 3] = Math.cos(angle) * radius;
    paperPositions[vertexIndex * 3 + 1] = height;
    paperPositions[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
    paperColors[vertexIndex * 3] = COLORS.paper.r;
    paperColors[vertexIndex * 3 + 1] = COLORS.paper.g;
    paperColors[vertexIndex * 3 + 2] = COLORS.paper.b;
  }
}
const paperIndexes = [];
for (let rowIndex = 0; rowIndex < PAPER_HEIGHT_ROWS - 1; rowIndex += 1) {
  for (let columnIndex = 0; columnIndex < PAPER_ANGLE_SEGMENTS; columnIndex += 1) {
    const lowerLeft = rowIndex * paperColumnCount + columnIndex;
    const lowerRight = lowerLeft + 1;
    const upperLeft = lowerLeft + paperColumnCount;
    const upperRight = upperLeft + 1;
    paperIndexes.push(lowerLeft, upperLeft, lowerRight, lowerRight, upperLeft, upperRight);
  }
}
const paperGeometry = new THREE.BufferGeometry();
paperGeometry.setAttribute("position", new THREE.BufferAttribute(paperPositions, 3));
paperGeometry.setAttribute("color", new THREE.BufferAttribute(paperColors, 3));
paperGeometry.setIndex(paperIndexes);
paperGeometry.computeVertexNormals();
dripperGroup.add(
  new THREE.Mesh(paperGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }))
);

const serverGlass = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.0, 6.6, 64, 1, true), glassMaterial);
serverGlass.position.y = -3.9;
scene.add(serverGlass);

const serverCoffee = new THREE.Mesh(
  new THREE.CylinderGeometry(3.9, 3.9, 1, 48),
  new THREE.MeshPhysicalMaterial({
    color: COLORS.clearWater,
    transmission: CLEAR_WATER_TRANSMISSION,
    thickness: 2,
    roughness: 0.15,
    ior: 1.34
  })
);
serverCoffee.visible = false;
scene.add(serverCoffee);

const scalePlate = new THREE.Mesh(new THREE.BoxGeometry(11, 0.5, 11), new THREE.MeshStandardMaterial({ color: 0x1d1a18, roughness: 0.6 }));
scalePlate.position.y = TABLE_HEIGHT + 0.05;
scene.add(scalePlate);

/* ---------- 원두 층과 물 표면 (격자 메시) ---------- */

const gridSize = 41;
const gridCellCount = gridSize * gridSize;
const isGridCellActive = new Uint8Array(gridCellCount);
const gridNormalizedX = new Float32Array(gridCellCount);
const gridNormalizedZ = new Float32Array(gridCellCount);
for (let row = 0; row < gridSize; row += 1) {
  for (let column = 0; column < gridSize; column += 1) {
    const cellIndex = row * gridSize + column;
    const normalizedX = (column / (gridSize - 1)) * 2 - 1;
    const normalizedZ = (row / (gridSize - 1)) * 2 - 1;
    gridNormalizedX[cellIndex] = normalizedX;
    gridNormalizedZ[cellIndex] = normalizedZ;
    isGridCellActive[cellIndex] = normalizedX * normalizedX + normalizedZ * normalizedZ <= 1 ? 1 : 0;
  }
}

function cellIndexAtNormalized(normalizedX, normalizedZ) {
  const column = clamp(Math.round(((normalizedX + 1) / 2) * (gridSize - 1)), 0, gridSize - 1);
  const row = clamp(Math.round(((normalizedZ + 1) / 2) * (gridSize - 1)), 0, gridSize - 1);
  return row * gridSize + column;
}

const cellSnapshot = {
  coffeeMillimeters: new Float32Array(gridCellCount),
  bedMillimeters: new Float32Array(gridCellCount),
  waterMillimeters: new Float32Array(gridCellCount),
  saturation: new Float32Array(gridCellCount),
  gasRemaining: new Float32Array(gridCellCount),
  extractionPercent: new Float32Array(gridCellCount)
};

function createGridGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(gridCellCount * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(gridCellCount * 3), 3));
  const triangleIndexes = [];
  for (let row = 0; row < gridSize - 1; row += 1) {
    for (let column = 0; column < gridSize - 1; column += 1) {
      const topLeft = row * gridSize + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + gridSize;
      const bottomRight = bottomLeft + 1;
      if (isGridCellActive[topLeft] && isGridCellActive[bottomLeft] && isGridCellActive[topRight]) {
        triangleIndexes.push(topLeft, bottomLeft, topRight);
      }
      if (isGridCellActive[topRight] && isGridCellActive[bottomLeft] && isGridCellActive[bottomRight]) {
        triangleIndexes.push(topRight, bottomLeft, bottomRight);
      }
    }
  }
  geometry.setIndex(triangleIndexes);
  return geometry;
}

const bedGeometry = createGridGeometry();
dripperGroup.add(new THREE.Mesh(bedGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));

const waterGeometry = createGridGeometry();
const waterMesh = new THREE.Mesh(
  waterGeometry,
  new THREE.MeshStandardMaterial({ color: COLORS.clearWater, transparent: true, opacity: CLEAR_WATER_SURFACE_OPACITY, roughness: 0.12, metalness: 0.05 })
);
dripperGroup.add(waterMesh);

/* 원두 층 표면의 가루 알갱이. 가루가 쌓인 만큼만 보이고, 젖으면 색이 진해집니다 */
const grainGeometry = new THREE.IcosahedronGeometry(1, 0);
const bedGrainMesh = new THREE.InstancedMesh(grainGeometry, new THREE.MeshStandardMaterial({ roughness: 1 }), BED_GRAIN_COUNT);
bedGrainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const bedGrainNormalizedX = new Float32Array(BED_GRAIN_COUNT);
const bedGrainNormalizedZ = new Float32Array(BED_GRAIN_COUNT);
const bedGrainThreshold = new Float32Array(BED_GRAIN_COUNT);
const bedGrainSize = new Float32Array(BED_GRAIN_COUNT);
const bedGrainRotation = new Float32Array(BED_GRAIN_COUNT * 3);
const bedGrainCellIndex = new Int32Array(BED_GRAIN_COUNT);
for (let grainIndex = 0; grainIndex < BED_GRAIN_COUNT; grainIndex += 1) {
  const radius = Math.sqrt(Math.random()) * 0.96;
  const angle = Math.random() * FULL_TURN_RADIANS;
  bedGrainNormalizedX[grainIndex] = Math.cos(angle) * radius;
  bedGrainNormalizedZ[grainIndex] = Math.sin(angle) * radius;
  bedGrainThreshold[grainIndex] = Math.random();
  bedGrainSize[grainIndex] = 0.7 + Math.random() * 0.6;
  bedGrainRotation[grainIndex * 3] = Math.random() * 3;
  bedGrainRotation[grainIndex * 3 + 1] = Math.random() * 3;
  bedGrainRotation[grainIndex * 3 + 2] = Math.random() * 3;
  bedGrainCellIndex[grainIndex] = cellIndexAtNormalized(bedGrainNormalizedX[grainIndex], bedGrainNormalizedZ[grainIndex]);
  bedGrainMesh.setColorAt(grainIndex, COLORS.dryGrounds);
}
dripperGroup.add(bedGrainMesh);

/* 뜸 들일 때 올라오는 거품 */
const bubblePositions = new Float32Array(BUBBLE_COUNT * 3);
const bubbleNormalizedX = new Float32Array(BUBBLE_COUNT);
const bubbleNormalizedZ = new Float32Array(BUBBLE_COUNT);
const bubbleCellIndexes = new Int32Array(BUBBLE_COUNT);
const bubblePhases = new Float32Array(BUBBLE_COUNT);
for (let bubbleIndex = 0; bubbleIndex < BUBBLE_COUNT; bubbleIndex += 1) {
  const radius = Math.sqrt(Math.random()) * 0.92;
  const angle = Math.random() * FULL_TURN_RADIANS;
  bubbleNormalizedX[bubbleIndex] = Math.cos(angle) * radius;
  bubbleNormalizedZ[bubbleIndex] = Math.sin(angle) * radius;
  bubbleCellIndexes[bubbleIndex] = cellIndexAtNormalized(bubbleNormalizedX[bubbleIndex], bubbleNormalizedZ[bubbleIndex]);
  bubblePhases[bubbleIndex] = Math.random() * FULL_TURN_RADIANS;
}
const bubbleGeometry = new THREE.BufferGeometry();
bubbleGeometry.setAttribute("position", new THREE.BufferAttribute(bubblePositions, 3));
dripperGroup.add(
  new THREE.Points(bubbleGeometry, new THREE.PointsMaterial({ color: 0xe9d3ad, size: 0.11, transparent: true, opacity: 0.9 }))
);

/* ---------- 주전자 ---------- */
/* 사용자는 주전자 몸통을 잡고 움직입니다. 몸통 가운데가 기준점이고, 누르고 있으면 주전자가 기울어 주둥이로 물이 나옵니다 */

const kettlePivot = new THREE.Group();
const kettleTilt = new THREE.Group();
const kettleModel = new THREE.Group();
kettlePivot.add(kettleTilt);
kettleTilt.add(kettleModel);
scene.add(kettlePivot);

kettleModel.add(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.2, 3.2, 40), steelMaterial));
const kettleLid = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.75, 0.4, 40), steelMaterial);
kettleLid.position.y = 1.8;
kettleModel.add(kettleLid);
const kettleKnob = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), darkHandleMaterial);
kettleKnob.position.y = 2.15;
kettleModel.add(kettleKnob);
const kettleHandle = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.2, 12, 24, Math.PI), darkHandleMaterial);
kettleHandle.rotation.z = Math.PI / 2;
kettleHandle.position.x = -2.1;
kettleModel.add(kettleHandle);

/* 드립 주전자의 가는 목은 끝이 아래를 향하게 휘어 있어서 물이 거의 수직으로 떨어집니다 */
const spoutTipLocal = new THREE.Vector3(5.85, 0.55, 0);
const spoutCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(1.8, -0.9, 0),
  new THREE.Vector3(3.1, 0.1, 0),
  new THREE.Vector3(4.3, 1.35, 0),
  new THREE.Vector3(5.3, 1.55, 0),
  new THREE.Vector3(5.75, 1.1, 0),
  spoutTipLocal.clone()
]);
kettleModel.add(new THREE.Mesh(new THREE.TubeGeometry(spoutCurve, 48, 0.17, 10, false), steelMaterial));
const spoutDirectionLocal = spoutCurve.getTangent(1).normalize();
/* 주전자 몸통은 화면 오른쪽에, 주둥이는 왼쪽(드리퍼 쪽)을 향하게 둡니다 */
kettlePivot.rotation.y = Math.PI;
kettlePivot.position.copy(KETTLE_PARKED_BODY);

/* ---------- 물줄기와 물방울 그리기 ---------- */

/* 물은 빛을 굴절시키는 투명한 액체로, 커피는 갈색이 비치는 액체로 그립니다 */
/* 투과 효과는 물줄기 바로 뒤의 장면만 비춰 보여서, 완전히 투명하게 두면 흰 필터 종이 앞에서 물줄기가 사라집니다.
   실제 물줄기는 주변의 어두운 방을 굴절시키고 반짝이는 띠가 생겨 보이므로, 투과를 줄이고 옅은 회청색과 겉면 광택을 줍니다 */
const waterLiquidMaterial = new THREE.MeshPhysicalMaterial({
  color: COLORS.clearWater,
  transmission: CLEAR_WATER_TRANSMISSION,
  thickness: 0.4,
  roughness: 0.05,
  ior: 1.33,
  specularIntensity: 1,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  envMapIntensity: 1.6,
  attenuationColor: new THREE.Color(0x8fb8d4),
  attenuationDistance: 1.2
});
/* 드리퍼에서 떨어지는 줄기는 물과 같은 재질에서 시작해, 녹아 나온 성분이 많을수록 커피 색으로 바뀝니다 */
const coffeeLiquidMaterial = waterLiquidMaterial.clone();

/* 이어진 물줄기를 관 모양으로 그립니다. 입자 사이를 매끈하게 나눠 그리면서
   표면 출렁임(레일리-플라토 불안정) 때문에 잘록해지고 불룩해지는 모양을 반지름에 반영합니다 */
function createStreamRenderer(material, maximumParticles) {
  const maximumRings = STREAM_TUBE_MAXIMUM_POINTS * STREAM_TUBE_SUBDIVISIONS + 2;
  const tubePositions = new Float32Array(maximumRings * STREAM_TUBE_SIDES * 3);
  const tubeIndexes = new Uint32Array(maximumRings * STREAM_TUBE_SIDES * 6);
  const tubeGeometry = new THREE.BufferGeometry();
  tubeGeometry.setAttribute("position", new THREE.BufferAttribute(tubePositions, 3));
  tubeGeometry.setIndex(new THREE.BufferAttribute(tubeIndexes, 1));
  tubeGeometry.setDrawRange(0, 0);
  const tubeMesh = new THREE.Mesh(tubeGeometry, material);
  tubeMesh.frustumCulled = false;
  scene.add(tubeMesh);

  const dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), material, maximumParticles + 1);
  dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dropMesh.frustumCulled = false;
  dropMesh.count = 0;
  scene.add(dropMesh);

  return {
    tubeGeometry: tubeGeometry,
    tubePositions: tubePositions,
    tubeIndexes: tubeIndexes,
    maximumRings: maximumRings,
    dropMesh: dropMesh,
    runIndexes: new Int32Array(STREAM_TUBE_MAXIMUM_POINTS + 1),
    isInTube: new Uint8Array(maximumParticles)
  };
}

const streamRingCenter = new THREE.Vector3();
const streamTangent = new THREE.Vector3();
const streamNormal = new THREE.Vector3();
const streamBinormal = new THREE.Vector3();
const streamReference = new THREE.Vector3();
const runPointsX = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS + 1);
const runPointsY = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS + 1);
const runPointsZ = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS + 1);
const runRadius = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS + 1);
const runCoordinate = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS + 1);
const runAmplitude = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS + 1);
const runWavelength = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS + 1);
const ringCentersX = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS * STREAM_TUBE_SUBDIVISIONS + 2);
const ringCentersY = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS * STREAM_TUBE_SUBDIVISIONS + 2);
const ringCentersZ = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS * STREAM_TUBE_SUBDIVISIONS + 2);
const ringRadii = new Float32Array(STREAM_TUBE_MAXIMUM_POINTS * STREAM_TUBE_SUBDIVISIONS + 2);
const dropTransform = new THREE.Object3D();
const dropVelocity = new THREE.Vector3();
const verticalAxis = new THREE.Vector3(0, 1, 0);

/* 네 점 사이를 부드럽게 잇는 곡선(캐트멀-롬)의 한 성분 */
function catmullRom(previousValue, startValue, endValue, nextValue, fraction) {
  const fractionSquared = fraction * fraction;
  const fractionCubed = fractionSquared * fraction;
  return 0.5 * (
    2 * startValue +
    (endValue - previousValue) * fraction +
    (2 * previousValue - 5 * startValue + 4 * endValue - nextValue) * fractionSquared +
    (3 * startValue - previousValue - 3 * endValue + nextValue) * fractionCubed
  );
}

/* 한 줄기(이어진 입자 묶음)를 관으로 만들어 버퍼에 붙입니다. 그린 고리 수를 돌려줍니다 */
function appendStreamRun(streamRenderer, pointCount, firstRing, indexCountBefore) {
  let ringCount = 0;
  for (let pointIndex = 0; pointIndex < pointCount - 1; pointIndex += 1) {
    const previousPoint = Math.max(0, pointIndex - 1);
    const nextPoint = Math.min(pointCount - 1, pointIndex + 2);
    const subdivisions = pointIndex === pointCount - 2 ? STREAM_TUBE_SUBDIVISIONS + 1 : STREAM_TUBE_SUBDIVISIONS;
    for (let subdivisionIndex = 0; subdivisionIndex < subdivisions; subdivisionIndex += 1) {
      if (firstRing + ringCount >= streamRenderer.maximumRings) {
        break;
      }
      const fraction = subdivisionIndex / STREAM_TUBE_SUBDIVISIONS;
      const ringIndex = firstRing + ringCount;
      ringCentersX[ringIndex] = catmullRom(runPointsX[previousPoint], runPointsX[pointIndex], runPointsX[pointIndex + 1], runPointsX[nextPoint], fraction);
      ringCentersY[ringIndex] = catmullRom(runPointsY[previousPoint], runPointsY[pointIndex], runPointsY[pointIndex + 1], runPointsY[nextPoint], fraction);
      ringCentersZ[ringIndex] = catmullRom(runPointsZ[previousPoint], runPointsZ[pointIndex], runPointsZ[pointIndex + 1], runPointsZ[nextPoint], fraction);
      const baseRadius = runRadius[pointIndex] + (runRadius[pointIndex + 1] - runRadius[pointIndex]) * fraction;
      const coordinate = runCoordinate[pointIndex] + (runCoordinate[pointIndex + 1] - runCoordinate[pointIndex]) * fraction;
      const waveAmplitude = Math.min(0.92, runAmplitude[pointIndex] + (runAmplitude[pointIndex + 1] - runAmplitude[pointIndex]) * fraction);
      const waveLength = runWavelength[pointIndex];
      ringRadii[ringIndex] = baseRadius * (1 + waveAmplitude * Math.cos((2 * Math.PI * coordinate) / waveLength));
      ringCount += 1;
    }
  }
  /* 끝은 둥글게 오므려 물줄기 끝이 막대처럼 잘려 보이지 않게 합니다 */
  if (ringCount > 0) {
    ringRadii[firstRing + ringCount - 1] *= 0.35;
  }

  const positions = streamRenderer.tubePositions;
  for (let ringOffset = 0; ringOffset < ringCount; ringOffset += 1) {
    const ringIndex = firstRing + ringOffset;
    const previousRing = firstRing + Math.max(0, ringOffset - 1);
    const nextRing = firstRing + Math.min(ringCount - 1, ringOffset + 1);
    streamTangent.set(
      ringCentersX[nextRing] - ringCentersX[previousRing],
      ringCentersY[nextRing] - ringCentersY[previousRing],
      ringCentersZ[nextRing] - ringCentersZ[previousRing]
    );
    if (streamTangent.lengthSq() < 1e-12) {
      streamTangent.set(0, -1, 0);
    }
    streamTangent.normalize();
    if (Math.abs(streamTangent.x) < 0.9) {
      streamReference.set(1, 0, 0);
    } else {
      streamReference.set(0, 0, 1);
    }
    streamNormal.crossVectors(streamTangent, streamReference).normalize();
    streamBinormal.crossVectors(streamTangent, streamNormal).normalize();
    for (let sideIndex = 0; sideIndex < STREAM_TUBE_SIDES; sideIndex += 1) {
      const sideAngle = (sideIndex / STREAM_TUBE_SIDES) * FULL_TURN_RADIANS;
      const radius = ringRadii[ringIndex] * STREAM_VISUAL_SCALE;
      streamRingCenter.set(ringCentersX[ringIndex], ringCentersY[ringIndex], ringCentersZ[ringIndex]);
      streamRingCenter.addScaledVector(streamNormal, Math.cos(sideAngle) * radius);
      streamRingCenter.addScaledVector(streamBinormal, Math.sin(sideAngle) * radius);
      const vertexOffset = (ringIndex * STREAM_TUBE_SIDES + sideIndex) * 3;
      positions[vertexOffset] = streamRingCenter.x;
      positions[vertexOffset + 1] = streamRingCenter.y;
      positions[vertexOffset + 2] = streamRingCenter.z;
    }
  }

  let indexCount = indexCountBefore;
  const indexes = streamRenderer.tubeIndexes;
  for (let ringOffset = 0; ringOffset < ringCount - 1; ringOffset += 1) {
    const ringIndex = firstRing + ringOffset;
    for (let sideIndex = 0; sideIndex < STREAM_TUBE_SIDES; sideIndex += 1) {
      const nextSide = (sideIndex + 1) % STREAM_TUBE_SIDES;
      const current = ringIndex * STREAM_TUBE_SIDES + sideIndex;
      const currentNext = ringIndex * STREAM_TUBE_SIDES + nextSide;
      const below = (ringIndex + 1) * STREAM_TUBE_SIDES + sideIndex;
      const belowNext = (ringIndex + 1) * STREAM_TUBE_SIDES + nextSide;
      indexes[indexCount] = current;
      indexes[indexCount + 1] = below;
      indexes[indexCount + 2] = currentNext;
      indexes[indexCount + 3] = currentNext;
      indexes[indexCount + 4] = below;
      indexes[indexCount + 5] = belowNext;
      indexCount += 6;
    }
  }
  return { ringCount: ringCount, indexCount: indexCount };
}

/* attachPoint: 물이 나오는 출구. 지금 흐르는 줄기는 출구까지 이어 그립니다.
   hangingDrop: 출구에 매달려 자라는 물방울 { x, y, z, radius } */
function renderStream(streamRenderer, simulation, attachPoint, hangingDrop) {
  streamRenderer.longestLink = 0;
  let ringsUsed = 0;
  let indexCount = 0;
  let particleIndex = simulation.getNewestIndex();
  const currentStream = simulation.getCurrentStreamIdentifier();

  /* 가장 최근 입자부터 거슬러 올라가며, 끊어지지 않고 이어진 입자 묶음마다 관을 하나씩 그립니다 */
  for (let visited = 0; visited < simulation.maximumParticles; visited += 1) {
    if (!simulation.isIntactStream(particleIndex)) {
      particleIndex = (particleIndex + simulation.maximumParticles - 1) % simulation.maximumParticles;
      continue;
    }
    const runStream = simulation.streamIdentifier[particleIndex];
    let pointCount = 0;
    let lastAddedIndex = particleIndex;
    const isAttachedRun = attachPoint && runStream === currentStream && visited === 0;
    if (isAttachedRun) {
      runPointsX[0] = attachPoint.x;
      runPointsY[0] = attachPoint.y;
      runPointsZ[0] = attachPoint.z;
      runRadius[0] = simulation.streamRadiusAt(particleIndex);
      runCoordinate[0] = simulation.materialCoordinate[particleIndex] + 0.3;
      runAmplitude[0] = simulation.amplitude[particleIndex];
      runWavelength[0] = simulation.wavelength[particleIndex];
      pointCount = 1;
    }
    while (
      pointCount < STREAM_TUBE_MAXIMUM_POINTS &&
      visited < simulation.maximumParticles &&
      simulation.isIntactStream(particleIndex) &&
      simulation.streamIdentifier[particleIndex] === runStream
    ) {
      if (pointCount > 0) {
        const linkDistance = Math.hypot(
          simulation.positionX[particleIndex] - runPointsX[pointCount - 1],
          simulation.positionY[particleIndex] - runPointsY[pointCount - 1],
          simulation.positionZ[particleIndex] - runPointsZ[pointCount - 1]
        );
        streamRenderer.longestLink = Math.max(streamRenderer.longestLink, Math.min(linkDistance, STREAM_MAXIMUM_LINK_CENTIMETERS));
        if (linkDistance > STREAM_MAXIMUM_LINK_CENTIMETERS) {
          break;
        }
      }
      streamRenderer.isInTube[particleIndex] = 1;
      runPointsX[pointCount] = simulation.positionX[particleIndex];
      runPointsY[pointCount] = simulation.positionY[particleIndex];
      runPointsZ[pointCount] = simulation.positionZ[particleIndex];
      runRadius[pointCount] = simulation.streamRadiusAt(particleIndex);
      runCoordinate[pointCount] = simulation.materialCoordinate[particleIndex];
      runAmplitude[pointCount] = simulation.amplitude[particleIndex];
      runWavelength[pointCount] = simulation.wavelength[particleIndex];
      lastAddedIndex = particleIndex;
      pointCount += 1;
      visited += 1;
      particleIndex = (particleIndex + simulation.maximumParticles - 1) % simulation.maximumParticles;
    }
    if (pointCount >= 2 && ringsUsed < streamRenderer.maximumRings - 2) {
      const appended = appendStreamRun(streamRenderer, pointCount, ringsUsed, indexCount);
      ringsUsed += appended.ringCount;
      indexCount = appended.indexCount;
    } else if (pointCount === 1 && !isAttachedRun) {
      /* 혼자 남은 조각은 물방울로 그립니다 */
      streamRenderer.isInTube[lastAddedIndex] = 0;
    }
  }

  const tubeGeometry = streamRenderer.tubeGeometry;
  tubeGeometry.getAttribute("position").needsUpdate = true;
  tubeGeometry.getIndex().needsUpdate = true;
  tubeGeometry.setDrawRange(0, indexCount);
  if (indexCount > 0) {
    tubeGeometry.computeVertexNormals();
  }

  /* 끊어져 나온 물방울: 떨어지는 방향으로 살짝 길쭉하게 그립니다 */
  let dropCount = 0;
  for (let dropIndex = 0; dropIndex < simulation.maximumParticles; dropIndex += 1) {
    if (!simulation.isAlive[dropIndex]) {
      continue;
    }
    if (streamRenderer.isInTube[dropIndex]) {
      streamRenderer.isInTube[dropIndex] = 0;
      continue;
    }
    const dropRadius = simulation.dropRadiusFor(simulation.mass[dropIndex]) * STREAM_VISUAL_SCALE;
    dropVelocity.set(simulation.velocityX[dropIndex], simulation.velocityY[dropIndex], simulation.velocityZ[dropIndex]);
    const speed = dropVelocity.length();
    dropTransform.position.set(simulation.positionX[dropIndex], simulation.positionY[dropIndex], simulation.positionZ[dropIndex]);
    if (speed > 1e-3) {
      dropTransform.quaternion.setFromUnitVectors(verticalAxis, dropVelocity.divideScalar(speed));
    } else {
      dropTransform.quaternion.identity();
    }
    const stretch = 1 + Math.min(0.25, speed / 600);
    dropTransform.scale.set(dropRadius / Math.sqrt(stretch), dropRadius * stretch, dropRadius / Math.sqrt(stretch));
    dropTransform.updateMatrix();
    streamRenderer.dropMesh.setMatrixAt(dropCount, dropTransform.matrix);
    dropCount += 1;
  }
  if (hangingDrop && hangingDrop.radius > 0.01) {
    dropTransform.position.set(hangingDrop.x, hangingDrop.y - hangingDrop.radius * 0.8, hangingDrop.z);
    dropTransform.quaternion.identity();
    dropTransform.scale.set(hangingDrop.radius, hangingDrop.radius * 1.25, hangingDrop.radius);
    dropTransform.updateMatrix();
    streamRenderer.dropMesh.setMatrixAt(dropCount, dropTransform.matrix);
    dropCount += 1;
  }
  streamRenderer.dropMesh.count = dropCount;
  streamRenderer.dropMesh.instanceMatrix.needsUpdate = true;
}

/* 물이 닿은 수면에 퍼져 나가는 동그란 물결 */
function createRippleSystem(color) {
  const ripples = [];
  for (let rippleIndex = 0; rippleIndex < RIPPLE_COUNT; rippleIndex += 1) {
    const ripple = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 40),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    );
    ripple.rotation.x = -Math.PI / 2;
    ripple.visible = false;
    scene.add(ripple);
    ripples.push({ mesh: ripple, age: 0, size: 1 });
  }
  return { ripples: ripples, nextIndex: 0, secondsSinceLastSpawn: 1 };
}

function spawnRipple(rippleSystem, positionX, positionY, positionZ, size) {
  if (rippleSystem.secondsSinceLastSpawn < RIPPLE_SPAWN_INTERVAL_SECONDS) {
    return;
  }
  rippleSystem.secondsSinceLastSpawn = 0;
  const ripple = rippleSystem.ripples[rippleSystem.nextIndex];
  rippleSystem.nextIndex = (rippleSystem.nextIndex + 1) % RIPPLE_COUNT;
  ripple.age = 0;
  ripple.size = size;
  ripple.mesh.position.set(positionX, positionY + 0.015, positionZ);
  ripple.mesh.visible = true;
}

function updateRippleSystem(rippleSystem, simulationSeconds) {
  rippleSystem.secondsSinceLastSpawn += simulationSeconds;
  rippleSystem.ripples.forEach(function growRipple(ripple) {
    if (!ripple.mesh.visible) {
      return;
    }
    ripple.age += simulationSeconds;
    const progress = ripple.age / RIPPLE_LIFETIME_SECONDS;
    if (progress >= 1) {
      ripple.mesh.visible = false;
      return;
    }
    const scale = ripple.size * (0.15 + progress);
    ripple.mesh.scale.set(scale, scale, scale);
    ripple.mesh.material.opacity = 0.45 * (1 - progress);
  });
}

function setRippleSystemColor(rippleSystem, color) {
  rippleSystem.ripples.forEach(function paintRipple(ripple) {
    ripple.mesh.material.color.copy(color);
  });
}

function clearRippleSystem(rippleSystem) {
  rippleSystem.ripples.forEach(function hideRipple(ripple) {
    ripple.mesh.visible = false;
  });
}

/* 물이 어딘가에 부딪힐 때 튀는 작은 물보라 */
function createSplashSystem(color) {
  const positions = new Float32Array(SPLASH_PARTICLE_COUNT * 3);
  for (let particleIndex = 0; particleIndex < SPLASH_PARTICLE_COUNT; particleIndex += 1) {
    positions[particleIndex * 3 + 1] = -1000;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: color, size: 0.07, transparent: true, opacity: 0.85 }));
  points.frustumCulled = false;
  scene.add(points);
  return {
    material: points.material,
    geometry: geometry,
    positions: positions,
    velocities: new Float32Array(SPLASH_PARTICLE_COUNT * 3),
    lifetimes: new Float32Array(SPLASH_PARTICLE_COUNT),
    nextIndex: 0
  };
}

function spawnSplash(splashSystem, positionX, positionY, positionZ, count, speed) {
  for (let spawnIndex = 0; spawnIndex < count; spawnIndex += 1) {
    const particleIndex = splashSystem.nextIndex;
    splashSystem.nextIndex = (splashSystem.nextIndex + 1) % SPLASH_PARTICLE_COUNT;
    const angle = Math.random() * FULL_TURN_RADIANS;
    const horizontalSpeed = speed * (0.3 + Math.random() * 0.5);
    splashSystem.positions[particleIndex * 3] = positionX;
    splashSystem.positions[particleIndex * 3 + 1] = positionY + 0.02;
    splashSystem.positions[particleIndex * 3 + 2] = positionZ;
    splashSystem.velocities[particleIndex * 3] = Math.cos(angle) * horizontalSpeed;
    splashSystem.velocities[particleIndex * 3 + 1] = speed * (0.6 + Math.random() * 0.6);
    splashSystem.velocities[particleIndex * 3 + 2] = Math.sin(angle) * horizontalSpeed;
    splashSystem.lifetimes[particleIndex] = 0.12 + Math.random() * 0.12;
  }
}

function updateSplashSystem(splashSystem, simulationSeconds) {
  for (let particleIndex = 0; particleIndex < SPLASH_PARTICLE_COUNT; particleIndex += 1) {
    if (splashSystem.lifetimes[particleIndex] <= 0) {
      continue;
    }
    splashSystem.lifetimes[particleIndex] -= simulationSeconds;
    if (splashSystem.lifetimes[particleIndex] <= 0) {
      splashSystem.positions[particleIndex * 3 + 1] = -1000;
      continue;
    }
    splashSystem.velocities[particleIndex * 3 + 1] -= StreamPhysics.gravity * simulationSeconds;
    splashSystem.positions[particleIndex * 3] += splashSystem.velocities[particleIndex * 3] * simulationSeconds;
    splashSystem.positions[particleIndex * 3 + 1] += splashSystem.velocities[particleIndex * 3 + 1] * simulationSeconds;
    splashSystem.positions[particleIndex * 3 + 2] += splashSystem.velocities[particleIndex * 3 + 2] * simulationSeconds;
  }
  splashSystem.geometry.getAttribute("position").needsUpdate = true;
}

function clearSplashSystem(splashSystem) {
  splashSystem.lifetimes.fill(0);
  for (let particleIndex = 0; particleIndex < SPLASH_PARTICLE_COUNT; particleIndex += 1) {
    splashSystem.positions[particleIndex * 3 + 1] = -1000;
  }
}

const kettleStream = StreamPhysics.createStreamSimulation({
  maximumParticles: KETTLE_STREAM_MAXIMUM_PARTICLES,
  outletRadiusCentimeters: SPOUT_OUTLET_RADIUS,
  jetThresholdGramsPerSecond: KETTLE_JET_THRESHOLD_GRAMS_PER_SECOND
});
const dripStream = StreamPhysics.createStreamSimulation({
  maximumParticles: DRIP_STREAM_MAXIMUM_PARTICLES,
  outletRadiusCentimeters: DRIPPER_OUTLET_RADIUS,
  jetThresholdGramsPerSecond: DRIP_JET_THRESHOLD_GRAMS_PER_SECOND
});
const kettleStreamRenderer = createStreamRenderer(waterLiquidMaterial, KETTLE_STREAM_MAXIMUM_PARTICLES);
const dripStreamRenderer = createStreamRenderer(coffeeLiquidMaterial, DRIP_STREAM_MAXIMUM_PARTICLES);
const waterSplash = createSplashSystem(0xcfe9f7);
const waterRipples = createRippleSystem(0xffffff);
const coffeeRipples = createRippleSystem(COLORS.clearWater);
const previousSpoutTip = new THREE.Vector3();
const previousDripOutlet = new THREE.Vector3();
let hasPreviousSpoutTip = false;
const coffeeSplash = createSplashSystem(COLORS.clearWater);

/* ---------- 그라인더 ---------- */

const grinderGroup = new THREE.Group();
grinderGroup.position.copy(GRINDER_POSITION);
scene.add(grinderGroup);

const burrHousingBottomY = JAR_BOTTOM_Y + JAR_HEIGHT;
const burrHousingHeight = BURR_HOUSING_TOP_Y - burrHousingBottomY;
const burrHousing = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, burrHousingHeight, 48), darkMetalMaterial);
burrHousing.position.y = burrHousingBottomY + burrHousingHeight / 2;
grinderGroup.add(burrHousing);

const hopperGlass = new THREE.Mesh(new THREE.CylinderGeometry(HOPPER_RADIUS, HOPPER_RADIUS, HOPPER_HEIGHT, 48, 1, true), glassMaterial);
hopperGlass.position.y = HOPPER_FLOOR_Y + HOPPER_HEIGHT / 2;
grinderGroup.add(hopperGlass);
const hopperRim = new THREE.Mesh(new THREE.TorusGeometry(HOPPER_RADIUS, 0.12, 10, 64), steelMaterial);
hopperRim.rotation.x = Math.PI / 2;
hopperRim.position.y = HOPPER_FLOOR_Y + HOPPER_HEIGHT;
grinderGroup.add(hopperRim);

/* 호퍼 바닥은 가운데 구멍(날)으로 내려가는 깔때기입니다 */
const funnelFloor = new THREE.Mesh(
  new THREE.LatheGeometry(
    [new THREE.Vector2(BEAN_HOLE_RADIUS, 0), new THREE.Vector2(HOPPER_RADIUS, (HOPPER_RADIUS - BEAN_HOLE_RADIUS) * FUNNEL_SLOPE)],
    48
  ),
  new THREE.MeshStandardMaterial({ color: 0x55555a, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide })
);
funnelFloor.position.y = HOPPER_FLOOR_Y;
grinderGroup.add(funnelFloor);

const burrHead = new THREE.Mesh(new THREE.CylinderGeometry(BEAN_HOLE_RADIUS, BEAN_HOLE_RADIUS * 0.6, 0.3, 12), steelMaterial);
burrHead.position.y = HOPPER_FLOOR_Y - 0.1;
grinderGroup.add(burrHead);

const crankShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, CRANK_HEIGHT - HOPPER_FLOOR_Y, 12), steelMaterial);
crankShaft.position.y = (CRANK_HEIGHT + HOPPER_FLOOR_Y) / 2;
grinderGroup.add(crankShaft);

const crankPivot = new THREE.Group();
crankPivot.position.y = CRANK_HEIGHT;
grinderGroup.add(crankPivot);
const crankArm = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.2, 0.5), steelMaterial);
crankArm.position.x = 2.15;
crankPivot.add(crankArm);
const crankKnob = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.42, 1.3, 24),
  new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.7 })
);
crankKnob.position.set(4.2, 0.7, 0);
crankPivot.add(crankKnob);

const beanMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 12, 8),
  new THREE.MeshStandardMaterial({ color: 0x4a2a17, roughness: 0.5 }),
  MAXIMUM_BEAN_COUNT
);
beanMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
grinderGroup.add(beanMesh);
const beanSpinAxes = [];
for (let beanIndex = 0; beanIndex < MAXIMUM_BEAN_COUNT; beanIndex += 1) {
  beanSpinAxes.push(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize());
}

/* ---------- 가루 통 (그라인더 아래에 끼워져 있다가 들고 다닐 수 있습니다) ---------- */

const jarPivot = new THREE.Group();
const jarTilt = new THREE.Group();
const jarModel = new THREE.Group();
jarPivot.add(jarTilt);
jarTilt.add(jarModel);
scene.add(jarPivot);

jarModel.add(new THREE.Mesh(new THREE.CylinderGeometry(JAR_RADIUS, JAR_RADIUS * 0.95, JAR_HEIGHT, 40, 1, true), glassMaterial));
const jarBottom = new THREE.Mesh(new THREE.CircleGeometry(JAR_RADIUS * 0.95, 40), glassMaterial);
jarBottom.rotation.x = -Math.PI / 2;
jarBottom.position.y = -JAR_HEIGHT / 2;
jarModel.add(jarBottom);
/* 통 입구 가장자리를 기준으로 기울도록 모델을 옮겨 둡니다 */
jarModel.position.set(-JAR_RADIUS, -JAR_HEIGHT / 2, 0);

const jarGrainMesh = new THREE.InstancedMesh(
  grainGeometry,
  new THREE.MeshStandardMaterial({ color: COLORS.dryGrounds, roughness: 1 }),
  JAR_GRAIN_CAPACITY
);
const jarGrainHeights = [];
for (let grainIndex = 0; grainIndex < JAR_GRAIN_CAPACITY; grainIndex += 1) {
  jarGrainHeights.push(Math.random());
}
/* 아래에서부터 차오르도록 높이 순서로 정렬해 둡니다 */
jarGrainHeights.sort(function ascending(first, second) {
  return first - second;
});
const jarGrainTransform = new THREE.Object3D();
for (let grainIndex = 0; grainIndex < JAR_GRAIN_CAPACITY; grainIndex += 1) {
  const radius = Math.sqrt(Math.random()) * (JAR_RADIUS - 0.2);
  const angle = Math.random() * FULL_TURN_RADIANS;
  jarGrainTransform.position.set(
    Math.cos(angle) * radius,
    -JAR_HEIGHT / 2 + 0.08 + jarGrainHeights[grainIndex] * JAR_HEIGHT * 0.75,
    Math.sin(angle) * radius
  );
  jarGrainTransform.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  jarGrainTransform.scale.setScalar(0.09 + Math.random() * 0.05);
  jarGrainTransform.updateMatrix();
  jarGrainMesh.setMatrixAt(grainIndex, jarGrainTransform.matrix);
}
jarGrainMesh.count = 0;
jarModel.add(jarGrainMesh);

const jarDockedPosition = new THREE.Vector3(GRINDER_POSITION.x + JAR_RADIUS, JAR_BOTTOM_Y + JAR_HEIGHT, GRINDER_POSITION.z);
jarPivot.position.copy(jarDockedPosition);
const jarCarriedTarget = new THREE.Vector3();

/* ---------- 떨어지는 가루 알갱이 ---------- */

const fallingPositions = new Float32Array(FALLING_PARTICLE_COUNT * 3);
const fallingVelocities = new Float32Array(FALLING_PARTICLE_COUNT);
const fallingStopHeights = new Float32Array(FALLING_PARTICLE_COUNT);
const fallingIsAlive = new Uint8Array(FALLING_PARTICLE_COUNT);
const fallingGeometry = new THREE.BufferGeometry();
fallingGeometry.setAttribute("position", new THREE.BufferAttribute(fallingPositions, 3));
scene.add(new THREE.Points(fallingGeometry, new THREE.PointsMaterial({ color: 0x8a5d3a, size: 0.13 })));
let nextFallingParticleIndex = 0;

function clearFallingParticles() {
  fallingIsAlive.fill(0);
  for (let particleIndex = 0; particleIndex < FALLING_PARTICLE_COUNT; particleIndex += 1) {
    fallingPositions[particleIndex * 3 + 1] = -1000;
  }
}
clearFallingParticles();

function spawnFallingParticle(positionX, positionY, positionZ, stopHeight, spread) {
  const particleIndex = nextFallingParticleIndex;
  nextFallingParticleIndex = (nextFallingParticleIndex + 1) % FALLING_PARTICLE_COUNT;
  fallingPositions[particleIndex * 3] = positionX + (Math.random() - 0.5) * spread;
  fallingPositions[particleIndex * 3 + 1] = positionY;
  fallingPositions[particleIndex * 3 + 2] = positionZ + (Math.random() - 0.5) * spread;
  fallingVelocities[particleIndex] = -1 - Math.random() * 2;
  fallingStopHeights[particleIndex] = stopHeight;
  fallingIsAlive[particleIndex] = 1;
}

function updateFallingParticles(deltaSeconds) {
  for (let particleIndex = 0; particleIndex < FALLING_PARTICLE_COUNT; particleIndex += 1) {
    if (!fallingIsAlive[particleIndex]) {
      continue;
    }
    fallingVelocities[particleIndex] -= 25 * deltaSeconds;
    fallingPositions[particleIndex * 3 + 1] += fallingVelocities[particleIndex] * deltaSeconds;
    if (fallingPositions[particleIndex * 3 + 1] < fallingStopHeights[particleIndex]) {
      fallingIsAlive[particleIndex] = 0;
      fallingPositions[particleIndex * 3 + 1] = -1000;
    }
  }
  fallingGeometry.getAttribute("position").needsUpdate = true;
}

/* ---------- 입력 좌표 변환 ---------- */

const raycaster = new THREE.Raycaster();
const pointerNormalized = new THREE.Vector2();
const horizontalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerWorld = new THREE.Vector3();

function projectPointerToHeight(event, height) {
  const bounds = viewport.getBoundingClientRect();
  pointerNormalized.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointerNormalized.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(pointerNormalized, camera);
  horizontalPlane.constant = -height;
  return raycaster.ray.intersectPlane(horizontalPlane, pointerWorld) !== null;
}

/* ---------- 원두 층 높이 ---------- */

let currentBedWorldRadius = coneRadiusAt(BED_FLOOR_Y) * 1.05;
let currentBedMeanY = BED_FLOOR_Y;
let currentWaterMeanY = BED_FLOOR_Y;

function bedWorldHeight(bedMillimeters) {
  return BED_FLOOR_Y + bedMillimeters * BED_MILLIMETER_TO_WORLD;
}

function worldToNormalized(worldX, worldZ) {
  return {
    x: (worldX - dripperGroup.position.x) / currentBedWorldRadius,
    z: (worldZ - dripperGroup.position.z) / currentBedWorldRadius
  };
}

/* ---------- 원두 층, 물, 알갱이, 종이 그리기 ---------- */

const temporaryColor = new THREE.Color();
const grainTransform = new THREE.Object3D();

function heatmapColor(extractionPercent, targetColor) {
  if (extractionPercent < 16) {
    targetColor.copy(COLORS.underExtracted);
  } else if (extractionPercent < 18) {
    targetColor.copy(COLORS.underExtracted).lerp(COLORS.idealExtracted, (extractionPercent - 16) / 2);
  } else if (extractionPercent <= 22) {
    targetColor.copy(COLORS.idealExtracted);
  } else if (extractionPercent < 24) {
    targetColor.copy(COLORS.idealExtracted).lerp(COLORS.overExtracted, (extractionPercent - 22) / 2);
  } else {
    targetColor.copy(COLORS.overExtracted);
  }
  return targetColor;
}

function groundsColorForCell(cellIndex, targetColor) {
  const saturation = cellSnapshot.saturation[cellIndex];
  targetColor.copy(COLORS.dryGrounds).lerp(COLORS.wetGrounds, clamp(saturation, 0, 1));
  let foamAmount = cellSnapshot.gasRemaining[cellIndex] * saturation;
  if (cellSnapshot.waterMillimeters[cellIndex] > 2) {
    foamAmount *= 0.3;
  }
  return targetColor.lerp(COLORS.bloomFoam, clamp(foamAmount * 0.85, 0, 1));
}

function updateBedAndWaterMeshes() {
  brewModel.exportCellState(cellSnapshot);

  let bedHeightSum = 0;
  let waterHeightSum = 0;
  let wetCellCount = 0;
  let activeCount = 0;
  for (let cellIndex = 0; cellIndex < gridCellCount; cellIndex += 1) {
    if (!isGridCellActive[cellIndex]) {
      continue;
    }
    activeCount += 1;
    const bedY = bedWorldHeight(cellSnapshot.bedMillimeters[cellIndex]);
    bedHeightSum += bedY;
    if (cellSnapshot.waterMillimeters[cellIndex] > HIDDEN_WATER_THRESHOLD_MILLIMETERS) {
      waterHeightSum += bedY + cellSnapshot.waterMillimeters[cellIndex] * WATER_MILLIMETER_TO_WORLD;
      wetCellCount += 1;
    }
  }
  currentBedMeanY = bedHeightSum / activeCount;
  currentWaterMeanY = currentBedMeanY;
  if (wetCellCount > 0) {
    currentWaterMeanY = waterHeightSum / wetCellCount;
  }
  /* 원뿔이라 원두 층이 높아질수록 넓어집니다. 가장자리는 필터 종이 뒤로 살짝 숨도록 5% 크게 그립니다 */
  currentBedWorldRadius = coneRadiusAt(currentBedMeanY) * 1.05;
  const waterWorldRadius = coneRadiusAt(currentWaterMeanY) * 1.05;

  const bedPositions = bedGeometry.getAttribute("position");
  const bedColors = bedGeometry.getAttribute("color");
  const waterPositions = waterGeometry.getAttribute("position");

  for (let cellIndex = 0; cellIndex < gridCellCount; cellIndex += 1) {
    const bedMillimeters = cellSnapshot.bedMillimeters[cellIndex];
    const bedY = bedWorldHeight(bedMillimeters);
    const normalizedX = gridNormalizedX[cellIndex];
    const normalizedZ = gridNormalizedZ[cellIndex];
    bedPositions.setXYZ(cellIndex, normalizedX * currentBedWorldRadius, bedY, normalizedZ * currentBedWorldRadius);

    if (isHeatmapVisible) {
      heatmapColor(cellSnapshot.extractionPercent[cellIndex], temporaryColor);
    } else {
      groundsColorForCell(cellIndex, temporaryColor);
      const coffeeMillimeters = cellSnapshot.coffeeMillimeters[cellIndex];
      if (coffeeMillimeters < 1) {
        temporaryColor.lerp(COLORS.paper, 1 - coffeeMillimeters);
      }
    }
    bedColors.setXYZ(cellIndex, temporaryColor.r, temporaryColor.g, temporaryColor.b);

    const waterMillimeters = cellSnapshot.waterMillimeters[cellIndex];
    let waterY = bedY - 0.06;
    if (waterMillimeters > HIDDEN_WATER_THRESHOLD_MILLIMETERS && !isHeatmapVisible) {
      waterY = bedY + waterMillimeters * WATER_MILLIMETER_TO_WORLD;
    }
    waterPositions.setXYZ(cellIndex, normalizedX * waterWorldRadius, waterY, normalizedZ * waterWorldRadius);
  }
  bedPositions.needsUpdate = true;
  bedColors.needsUpdate = true;
  waterPositions.needsUpdate = true;
  bedGeometry.computeVertexNormals();
  waterGeometry.computeVertexNormals();
  waterMesh.visible = wetCellCount > 0 && !isHeatmapVisible;

  updateBedGrains();
  updateBubbles();
}

function updateBedGrains() {
  const grainScale = 0.06 + readSettings().grindSetting * 0.01;
  const visibilityThickness = brewModel.referenceBedMillimeters * 0.5;
  for (let grainIndex = 0; grainIndex < BED_GRAIN_COUNT; grainIndex += 1) {
    const cellIndex = bedGrainCellIndex[grainIndex];
    const coffeeMillimeters = cellSnapshot.coffeeMillimeters[cellIndex];
    const isVisible = !isHeatmapVisible && coffeeMillimeters > bedGrainThreshold[grainIndex] * visibilityThickness + 0.2;
    if (isVisible) {
      grainTransform.position.set(
        bedGrainNormalizedX[grainIndex] * currentBedWorldRadius,
        bedWorldHeight(cellSnapshot.bedMillimeters[cellIndex]) + 0.01,
        bedGrainNormalizedZ[grainIndex] * currentBedWorldRadius
      );
      grainTransform.rotation.set(
        bedGrainRotation[grainIndex * 3],
        bedGrainRotation[grainIndex * 3 + 1],
        bedGrainRotation[grainIndex * 3 + 2]
      );
      grainTransform.scale.setScalar(grainScale * bedGrainSize[grainIndex]);
      groundsColorForCell(cellIndex, temporaryColor);
      bedGrainMesh.setColorAt(grainIndex, temporaryColor);
    } else {
      grainTransform.scale.setScalar(0);
    }
    grainTransform.updateMatrix();
    bedGrainMesh.setMatrixAt(grainIndex, grainTransform.matrix);
  }
  bedGrainMesh.instanceMatrix.needsUpdate = true;
  if (bedGrainMesh.instanceColor) {
    bedGrainMesh.instanceColor.needsUpdate = true;
  }
}

function updateBubbles() {
  const positionAttribute = bubbleGeometry.getAttribute("position");
  for (let bubbleIndex = 0; bubbleIndex < BUBBLE_COUNT; bubbleIndex += 1) {
    const cellIndex = bubbleCellIndexes[bubbleIndex];
    const foamAmount = cellSnapshot.gasRemaining[cellIndex] * cellSnapshot.saturation[cellIndex];
    const waterMillimeters = cellSnapshot.waterMillimeters[cellIndex];
    let bubbleY = -1000;
    if (!isHeatmapVisible && foamAmount > 0.3 && waterMillimeters < 4) {
      const wobble = Math.sin(sceneClockSeconds * 3 + bubblePhases[bubbleIndex]) * 0.03;
      bubbleY = bedWorldHeight(cellSnapshot.bedMillimeters[cellIndex]) + waterMillimeters * WATER_MILLIMETER_TO_WORLD + 0.06 + wobble;
    }
    positionAttribute.setXYZ(
      bubbleIndex,
      bubbleNormalizedX[bubbleIndex] * currentBedWorldRadius,
      bubbleY,
      bubbleNormalizedZ[bubbleIndex] * currentBedWorldRadius
    );
  }
  positionAttribute.needsUpdate = true;
}

/* 종이가 원두 층이나 물에 닿은 높이를 방향마다 구해 젖음 모델에 넘깁니다 */
const paperContactHeights = new Float32Array(PAPER_ANGLE_SEGMENTS);
const paperContactStains = new Float32Array(PAPER_ANGLE_SEGMENTS);

function updatePaper(simulationSeconds) {
  for (let angleIndex = 0; angleIndex < PAPER_ANGLE_SEGMENTS; angleIndex += 1) {
    const angle = (angleIndex / PAPER_ANGLE_SEGMENTS) * FULL_TURN_RADIANS;
    const cellIndex = cellIndexAtNormalized(
      Math.cos(angle) * PAPER_CONTACT_SAMPLE_RADIUS,
      Math.sin(angle) * PAPER_CONTACT_SAMPLE_RADIUS
    );
    const coffeeMillimeters = cellSnapshot.coffeeMillimeters[cellIndex];
    const waterMillimeters = cellSnapshot.waterMillimeters[cellIndex];
    const saturation = cellSnapshot.saturation[cellIndex];
    const isTouchingLiquid = waterMillimeters > HIDDEN_WATER_THRESHOLD_MILLIMETERS || saturation > 0.05;
    if (!isTouchingLiquid) {
      paperContactHeights[angleIndex] = -1;
      paperContactStains[angleIndex] = 0;
      continue;
    }
    paperContactHeights[angleIndex] =
      bedWorldHeight(cellSnapshot.bedMillimeters[cellIndex]) + waterMillimeters * WATER_MILLIMETER_TO_WORLD;
    if (coffeeMillimeters > 0.3) {
      paperContactStains[angleIndex] = clamp(0.3 + cellSnapshot.extractionPercent[cellIndex] / 16, 0, 0.95);
    } else {
      paperContactStains[angleIndex] = 0.05;
    }
  }
  if (simulationSeconds > 0) {
    paperModel.step(simulationSeconds, paperContactHeights, paperContactStains);
  }

  const colorAttribute = paperGeometry.getAttribute("color");
  for (let rowIndex = 0; rowIndex < PAPER_HEIGHT_ROWS; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < paperColumnCount; columnIndex += 1) {
      const angleIndex = columnIndex % PAPER_ANGLE_SEGMENTS;
      const wetness = paperModel.readWetness(angleIndex, rowIndex);
      const stain = paperModel.readStain(angleIndex, rowIndex);
      const visibleWetness = clamp(wetness / PAPER_WETNESS_FOR_FULL_DARKENING, 0, 1);
      temporaryColor.copy(COLORS.paper).lerp(COLORS.wetPaper, visibleWetness);
      temporaryColor.lerp(COLORS.stainedPaper, clamp(stain * visibleWetness * 0.75, 0, 1));
      colorAttribute.setXYZ(rowIndex * paperColumnCount + columnIndex, temporaryColor.r, temporaryColor.g, temporaryColor.b);
    }
  }
  colorAttribute.needsUpdate = true;
}

/* 서버의 커피 높이는 실제로 떨어져 닿은 커피 방울의 양으로 정합니다 */
function updateServer() {
  const coffeeHeight = clamp(dripState.landedGrams / SERVER_CAPACITY_GRAMS, 0, 1) * SERVER_INNER_HEIGHT;
  serverCoffee.visible = coffeeHeight > 0.02;
  serverCoffee.scale.y = Math.max(0.001, coffeeHeight);
  serverCoffee.position.y = TABLE_HEIGHT + 0.3 + coffeeHeight / 2;
}

/* ---------- 커피 농도에 따른 색 ---------- */

const liquidTint = new THREE.Color();
const whiteColor = new THREE.Color(0xffffff);
const streamLiquidColor = new THREE.Color();
const bedLiquidColor = new THREE.Color();
const serverLiquidColor = new THREE.Color();

/* 농도(%)와 보이는 두께(cm)로 액체 색을 정해 targetColor에 넣고, 커피 색이 얼마나 짙은지(0–1)를 돌려줍니다.
   농도가 0이면 맑은 물 색 그대로입니다 */
function liquidColorForStrength(strengthPercent, viewDepthCentimeters, targetColor) {
  const opticalDepth = Math.max(0, strengthPercent) * viewDepthCentimeters;
  const redTransmittance = Math.exp(-COFFEE_ABSORPTION_PER_PERCENT_CENTIMETER.red * opticalDepth);
  const greenTransmittance = Math.exp(-COFFEE_ABSORPTION_PER_PERCENT_CENTIMETER.green * opticalDepth);
  const blueTransmittance = Math.exp(-COFFEE_ABSORPTION_PER_PERCENT_CENTIMETER.blue * opticalDepth);
  const coffeeDarkness = 1 - greenTransmittance;
  /* 물의 푸른 기는 커피 색이 짙어질수록 묻혀서 보이지 않게 됩니다 */
  liquidTint.copy(COLORS.clearWater).lerp(whiteColor, coffeeDarkness);
  targetColor.setRGB(
    liquidTint.r * redTransmittance,
    liquidTint.g * greenTransmittance,
    liquidTint.b * blueTransmittance
  );
  return coffeeDarkness;
}

function followValue(currentValue, targetValue, deltaSeconds, followSeconds) {
  return currentValue + (targetValue - currentValue) * Math.min(1, deltaSeconds / followSeconds);
}

/* 원두 층의 물, 떨어지는 커피 줄기, 서버의 커피 색을 지금 농도에 맞춥니다 */
function updateLiquidColors(simulationSeconds) {
  const liveStrength = brewModel.measureLiveStrength();

  /* 떨어지는 줄기 = 원두 층을 지나온 커피 + 필터 벽을 타고 바로 내려온 물. 벽을 탄 물만큼 묽어집니다 */
  const newPercolatedGrams = brewModel.state.percolatedTotalGrams - liquidColorState.previousPercolatedGrams;
  const newBypassGrams = brewModel.state.bypassGrams - liquidColorState.previousBypassGrams;
  liquidColorState.previousPercolatedGrams = brewModel.state.percolatedTotalGrams;
  liquidColorState.previousBypassGrams = brewModel.state.bypassGrams;
  const newDrippingGrams = newPercolatedGrams + newBypassGrams;
  if (newDrippingGrams > 1e-6 && simulationSeconds > 0) {
    const drippingStrengthPercent = (liveStrength.bedLiquidStrengthPercent * newPercolatedGrams) / newDrippingGrams;
    liquidColorState.streamStrengthPercent = followValue(
      liquidColorState.streamStrengthPercent,
      drippingStrengthPercent,
      simulationSeconds,
      STREAM_COLOR_FOLLOW_SECONDS
    );
  }
  if (simulationSeconds > 0) {
    liquidColorState.serverStrengthPercent = followValue(
      liquidColorState.serverStrengthPercent,
      liveStrength.beverageStrengthPercent,
      simulationSeconds,
      SERVER_COLOR_FOLLOW_SECONDS
    );
  }

  const bedDarkness = liquidColorForStrength(liveStrength.bedLiquidStrengthPercent, BED_LIQUID_VIEW_DEPTH_CENTIMETERS, bedLiquidColor);
  waterMesh.material.color.copy(bedLiquidColor);
  waterMesh.material.opacity = CLEAR_WATER_SURFACE_OPACITY + (STRONG_COFFEE_SURFACE_OPACITY - CLEAR_WATER_SURFACE_OPACITY) * bedDarkness;

  const streamDarkness = liquidColorForStrength(liquidColorState.streamStrengthPercent, STREAM_VIEW_DEPTH_CENTIMETERS, streamLiquidColor);
  coffeeLiquidMaterial.color.copy(streamLiquidColor);
  coffeeLiquidMaterial.attenuationColor.copy(streamLiquidColor);
  coffeeLiquidMaterial.transmission =
    CLEAR_WATER_TRANSMISSION + (STRONG_COFFEE_STREAM_TRANSMISSION - CLEAR_WATER_TRANSMISSION) * streamDarkness;
  coffeeSplash.material.color.copy(streamLiquidColor);

  const serverDarkness = liquidColorForStrength(liquidColorState.serverStrengthPercent, SERVER_VIEW_DEPTH_CENTIMETERS, serverLiquidColor);
  serverCoffee.material.color.copy(serverLiquidColor);
  serverCoffee.material.transmission = CLEAR_WATER_TRANSMISSION * (1 - serverDarkness);
  /* 수면의 물결은 액체보다 밝은 반사광으로 보입니다 */
  temporaryColor.copy(serverLiquidColor).lerp(whiteColor, RIPPLE_HIGHLIGHT_WHITENESS);
  setRippleSystemColor(coffeeRipples, temporaryColor);
}

/* ---------- 그라인더 ---------- */

function createGrinderForDose() {
  const settings = readSettings();
  const beanCount = clamp(Math.round(settings.doseGrams / GRAMS_PER_BEAN), 20, MAXIMUM_BEAN_COUNT);
  grindState.beanCount = beanCount;
  grindState.gramsPerBean = settings.doseGrams / beanCount;
  grinderPhysics = GrinderPhysics.createGrinderPhysics({
    beanCount: beanCount,
    beanRadius: BEAN_RADIUS,
    hopperRadius: HOPPER_RADIUS - 0.1,
    floorHeight: 0,
    holeRadius: BEAN_HOLE_RADIUS,
    funnelSlope: FUNNEL_SLOPE,
    beansPerRadian: beanCount / (settings.doseGrams * ROTATIONS_PER_GRAM * FULL_TURN_RADIANS)
  });
  /* 처음에 원두가 호퍼 바닥으로 자리 잡도록 잠깐 떨어뜨려 둡니다 */
  for (let settleStep = 0; settleStep < 90; settleStep += 1) {
    grinderPhysics.step(1 / 60, 0);
  }
}

/* 너무 빨리 돌리면 고운 가루가 늘어납니다. 원래 가늘게 가는 설정일수록 고운 가루가 조금 더 많습니다 */
function finesForCrankSpeed(rotationsPerSecond) {
  const grindSetting = readSettings().grindSetting;
  const speedPenalty = Math.max(0, rotationsPerSecond - COMFORTABLE_CRANK_SPEED_ROTATIONS_PER_SECOND) * FINES_PER_EXTRA_ROTATION_SPEED;
  const grindPenalty = Math.max(0, 5 - grindSetting) * 0.01;
  return clamp(BASE_FINES_FRACTION + speedPenalty + grindPenalty, BASE_FINES_FRACTION, MAXIMUM_FINES_FRACTION);
}

function calculateFinesFraction() {
  if (grindState.groundGrams <= 0) {
    return finesForCrankSpeed(0);
  }
  return grindState.finesWeightedSum / grindState.groundGrams;
}

function handleGrindPointer(event) {
  if (!projectPointerToHeight(event, CRANK_HEIGHT)) {
    return;
  }
  const pointerAngle = Math.atan2(pointerWorld.z - GRINDER_POSITION.z, pointerWorld.x - GRINDER_POSITION.x);
  if (grindState.previousPointerAngle !== null) {
    let deltaRadians = pointerAngle - grindState.previousPointerAngle;
    if (deltaRadians > Math.PI) {
      deltaRadians -= FULL_TURN_RADIANS;
    } else if (deltaRadians < -Math.PI) {
      deltaRadians += FULL_TURN_RADIANS;
    }
    const elapsedSeconds = Math.max(1 / 240, sceneClockSeconds - grindState.previousPointerSecond);
    /* 화면에서 시계 방향으로 돌린 만큼만 날이 돕니다 (반대로 돌리면 헛돕니다) */
    grindState.pointerAngularVelocity = Math.max(0, deltaRadians) / elapsedSeconds;
    grindState.crankAngle += Math.max(0, deltaRadians);
  }
  grindState.previousPointerAngle = pointerAngle;
  grindState.previousPointerSecond = sceneClockSeconds;
}

function updateGrinder(deltaSeconds) {
  let targetAngularVelocity = 0;
  if (grindState.isAutomatic) {
    targetAngularVelocity = AUTOMATIC_CRANK_SPEED_ROTATIONS_PER_SECOND * FULL_TURN_RADIANS;
    grindState.crankAngle += targetAngularVelocity * deltaSeconds;
  } else if (selectedTool === "grind" && isPrimaryPointerDown) {
    targetAngularVelocity = grindState.pointerAngularVelocity;
    /* 포인터가 멈춰 있으면 손잡이도 멈춘 것으로 봅니다 */
    if (sceneClockSeconds - grindState.previousPointerSecond > CRANK_IDLE_SECONDS) {
      targetAngularVelocity = 0;
    }
  }
  grindState.crankAngularVelocity += (targetAngularVelocity - grindState.crankAngularVelocity) * CRANK_SPEED_SMOOTHING;
  crankPivot.rotation.y = -grindState.crankAngle;

  const groundBeansNow = grinderPhysics.step(deltaSeconds, grindState.crankAngularVelocity);
  if (groundBeansNow > 0) {
    addGroundBeans(groundBeansNow, grindState.crankAngularVelocity / FULL_TURN_RADIANS);
  }

  if (grindState.isAutomatic) {
    const isTimedOut = sceneClockSeconds - grindState.automaticStartSecond > AUTOMATIC_GRIND_TIMEOUT_SECONDS;
    if (isTimedOut) {
      const remainingBeans = grinderPhysics.grindAllRemaining();
      if (remainingBeans > 0) {
        addGroundBeans(remainingBeans, AUTOMATIC_CRANK_SPEED_ROTATIONS_PER_SECOND);
      }
    }
    if (grinderPhysics.getGroundCount() >= grindState.beanCount) {
      grindState.isAutomatic = false;
    }
  }
  renderBeans();
}

function addGroundBeans(beanCount, rotationsPerSecond) {
  lockSettings();
  const grams = beanCount * grindState.gramsPerBean;
  grindState.groundGrams += grams;
  grindState.finesWeightedSum += grams * finesForCrankSpeed(rotationsPerSecond);
  brewModel.setFinesFraction(calculateFinesFraction());

  /* 가루 통을 들고 있으면 갈린 가루는 작업대로 쏟아집니다 */
  const isJarDocked = selectedTool !== "grounds";
  if (isJarDocked) {
    jarState.grams += grams;
  }
  const outletY = JAR_BOTTOM_Y + JAR_HEIGHT;
  const pileTopY = JAR_BOTTOM_Y + 0.2 + (jarGrainMesh.count / JAR_GRAIN_CAPACITY) * JAR_HEIGHT * 0.75;
  for (let particleIndex = 0; particleIndex < beanCount * FALLING_PARTICLES_PER_BEAN; particleIndex += 1) {
    spawnFallingParticle(GRINDER_POSITION.x, outletY, GRINDER_POSITION.z, isJarDocked ? pileTopY : TABLE_HEIGHT, 0.6);
  }
}

const beanTransform = new THREE.Object3D();

function renderBeans() {
  for (let beanIndex = 0; beanIndex < MAXIMUM_BEAN_COUNT; beanIndex += 1) {
    const isPresent = beanIndex < grinderPhysics.beanCount && !grinderPhysics.isGround[beanIndex];
    if (isPresent) {
      beanTransform.position.set(
        grinderPhysics.positions[beanIndex * 3],
        HOPPER_FLOOR_Y + grinderPhysics.positions[beanIndex * 3 + 1],
        grinderPhysics.positions[beanIndex * 3 + 2]
      );
      beanTransform.quaternion.setFromAxisAngle(beanSpinAxes[beanIndex], grinderPhysics.spinAngles[beanIndex]);
      beanTransform.scale.set(BEAN_RADIUS * 1.25, BEAN_RADIUS * 0.8, BEAN_RADIUS * 0.95);
    } else {
      beanTransform.scale.setScalar(0);
    }
    beanTransform.updateMatrix();
    beanMesh.setMatrixAt(beanIndex, beanTransform.matrix);
  }
  beanMesh.instanceMatrix.needsUpdate = true;
}

/* ---------- 가루 통 ---------- */

function updateJar(deltaSeconds) {
  const maximumJarGrams = Math.max(readSettings().doseGrams, 1);
  jarGrainMesh.count = Math.round(clamp(jarState.grams / maximumJarGrams, 0, 1) * JAR_GRAIN_CAPACITY);

  const isCarried = selectedTool === "grounds" && !isBrewFinished();
  let isPouringGrounds = false;
  if (isCarried) {
    const distance = Math.hypot(jarState.pointerX, jarState.pointerZ);
    if (distance > 0.01) {
      /* 통 몸통은 드리퍼 바깥쪽에, 입구는 가리킨 곳에 오도록 돌립니다 */
      jarPivot.rotation.y = Math.atan2(jarState.pointerZ / distance, -jarState.pointerX / distance);
    }
    jarCarriedTarget.set(jarState.pointerX, JAR_POUR_HEIGHT, jarState.pointerZ);
    jarPivot.position.lerp(jarCarriedTarget, 0.35);
    isPouringGrounds = isPrimaryPointerDown && jarState.grams > 0.001;
  } else {
    jarPivot.position.lerp(jarDockedPosition, 0.2);
    jarPivot.rotation.y = 0;
  }
  jarTilt.rotation.z = THREE.MathUtils.lerp(jarTilt.rotation.z, isPouringGrounds ? -1.1 : 0, 0.2);

  if (isPouringGrounds && jarTilt.rotation.z < -0.6) {
    const grams = Math.min(jarState.grams, GROUNDS_POUR_RATE_GRAMS_PER_SECOND * deltaSeconds);
    jarState.grams -= grams;
    const isOverDripper = Math.hypot(jarPivot.position.x, jarPivot.position.z) < CONE_TOP_RADIUS;
    let stopHeight = TABLE_HEIGHT;
    if (isOverDripper) {
      const normalized = worldToNormalized(jarPivot.position.x, jarPivot.position.z);
      brewModel.depositGrounds(normalized.x, normalized.z, grams);
      stopHeight = currentBedMeanY;
    }
    for (let particleIndex = 0; particleIndex < 5; particleIndex += 1) {
      spawnFallingParticle(jarPivot.position.x, jarPivot.position.y - 0.2, jarPivot.position.z, stopHeight, 0.5);
    }
  }
}

/* 사용자는 화면에서 드리퍼 입구를 가리키므로, 드리퍼 테두리 높이에서 가리킨 곳 위로 통을 옮깁니다 */
function handleJarPointer(event) {
  if (!projectPointerToHeight(event, CONE_HEIGHT)) {
    return;
  }
  jarState.pointerX = pointerWorld.x;
  jarState.pointerZ = pointerWorld.z;
}

/* ---------- 흔들기 ---------- */

function handleShakePointer(event) {
  if (!isPrimaryPointerDown || isBrewFinished()) {
    return;
  }
  if (!projectPointerToHeight(event, CONE_HEIGHT)) {
    return;
  }
  if (shakeState.previousX === null) {
    shakeState.previousX = pointerWorld.x;
    return;
  }
  const deltaX = pointerWorld.x - shakeState.previousX;
  shakeState.previousX = pointerWorld.x;
  const direction = Math.sign(deltaX);
  if (direction === 0) {
    return;
  }
  if (direction !== shakeState.direction) {
    if (shakeState.travel > SHAKE_MINIMUM_TRAVEL) {
      brewModel.shakeDripper();
      shakeState.dripperJiggle = 0.35 * direction;
    }
    shakeState.direction = direction;
    shakeState.travel = 0;
  }
  shakeState.travel += Math.abs(deltaX);
}

/* ---------- 주전자로 물 붓기 ---------- */

/* 포인터는 주전자 몸통을 가리킵니다. 주전자 몸통 높이의 평면에 포인터를 비춰 몸통 위치로 씁니다 */
function handleWaterPointer(event) {
  if (pourState.isAutomaticRunning) {
    return;
  }
  if (projectPointerToHeight(event, KETTLE_BODY_HEIGHT)) {
    pourState.kettleTargetX = pointerWorld.x;
    pourState.kettleTargetZ = pointerWorld.z;
  }
}

function setAutomaticPouring(isRunning) {
  pourState.isAutomaticRunning = isRunning;
  if (isRunning) {
    automaticPourButton.textContent = "자동 붓기 멈추기";
  } else {
    automaticPourButton.textContent = "레시피대로 자동 붓기";
  }
}

const spoutTipWorld = new THREE.Vector3();
const spoutDirectionWorld = new THREE.Vector3();

function computeSpoutExit() {
  kettlePivot.updateMatrixWorld(true);
  kettleInverseMatrix.copy(kettleModel.matrixWorld).invert();
  spoutTipWorld.copy(spoutTipLocal);
  kettleModel.localToWorld(spoutTipWorld);
  spoutDirectionWorld.copy(spoutDirectionLocal).transformDirection(kettleModel.matrixWorld);
}

/* 물줄기가 지금 자세에서 몸통 기준으로 얼마나 떨어진 곳에 닿는지 어림합니다(주둥이 위치 + 떨어지는 동안 옆으로 가는 거리) */
function estimateLandingOffset(flowGramsPerSecond) {
  const exitSpeed = kettleStream.exitSpeedFor(Math.max(flowGramsPerSecond, 0.5));
  const fallHeight = Math.max(0.1, spoutTipWorld.y - currentWaterMeanY);
  const downwardSpeed = -spoutDirectionWorld.y * exitSpeed;
  const fallSeconds =
    (-downwardSpeed + Math.sqrt(downwardSpeed * downwardSpeed + 2 * StreamPhysics.gravity * fallHeight)) / StreamPhysics.gravity;
  return {
    x: spoutTipWorld.x - kettlePivot.position.x + spoutDirectionWorld.x * exitSpeed * fallSeconds,
    z: spoutTipWorld.z - kettlePivot.position.z + spoutDirectionWorld.z * exitSpeed * fallSeconds
  };
}

/* 레시피 시간표대로 나선을 그리며 붓습니다. 지금 물을 부어야 하면 true를 돌려줍니다 */
function runAutomaticPouring(simulationSeconds) {
  const schedule = getScaledSchedule();
  const elapsedSeconds = brewModel.state.elapsedSeconds;
  let targetGrams = 0;
  let isBloomStep = true;
  schedule.forEach(function findCurrentTarget(step, stepIndex) {
    if (elapsedSeconds >= step.atSecond) {
      targetGrams = step.cumulativeGrams;
      isBloomStep = stepIndex === 0;
    }
  });

  /* 가운데에서 바깥으로 갔다가 돌아오는 나선을 그리도록, 물이 닿을 곳에서 거꾸로 주전자 위치를 정합니다 */
  pourState.automaticAngle += AUTOMATIC_POUR_ANGULAR_SPEED * simulationSeconds;
  const maximumRadius = isBloomStep ? 0.65 : 0.55;
  const radiusFraction = 0.12 + (maximumRadius - 0.12) * (0.5 - 0.5 * Math.cos(pourState.automaticAngle * 0.25));
  const landingX = Math.cos(pourState.automaticAngle) * radiusFraction * currentBedWorldRadius;
  const landingZ = Math.sin(pourState.automaticAngle) * radiusFraction * currentBedWorldRadius;
  const landingOffset = estimateLandingOffset(FluidBrewModel.pourRates[selectedPourRate]);
  pourState.kettleTargetX = landingX - landingOffset.x;
  pourState.kettleTargetZ = landingZ - landingOffset.z;

  const finalGrams = schedule[schedule.length - 1].cumulativeGrams;
  const pouredIncludingFlight = brewModel.state.totalPouredGrams + waterInFlightGrams();
  if (pouredIncludingFlight >= finalGrams - 0.05) {
    setAutomaticPouring(false);
    return false;
  }
  return pouredIncludingFlight < targetGrams - 0.05;
}

function waterInFlightGrams() {
  let grams = 0;
  for (let particleIndex = 0; particleIndex < kettleStream.maximumParticles; particleIndex += 1) {
    if (kettleStream.isAlive[particleIndex]) {
      grams += kettleStream.mass[particleIndex];
    }
  }
  return grams;
}

const kettleHeldTarget = new THREE.Vector3();
const kettleMove = new THREE.Vector3();

/* 목표 위치로 부드럽게 다가가되, 한 프레임에 너무 멀리 뛰지 않게 속도를 제한합니다 */
function moveKettleToward(target, deltaSeconds) {
  kettleMove.subVectors(target, kettlePivot.position);
  kettleMove.multiplyScalar(Math.min(1, KETTLE_FOLLOW_STIFFNESS_PER_SECOND * deltaSeconds));
  const maximumStep = KETTLE_MAXIMUM_SPEED_CENTIMETERS_PER_SECOND * deltaSeconds;
  if (kettleMove.length() > maximumStep) {
    kettleMove.setLength(maximumStep);
  }
  kettlePivot.position.add(kettleMove);
}

const cameraRightDirection = new THREE.Vector3();

/* 주전자 모델의 주둥이는 모델 기준 +x 방향입니다. 이것이 카메라 기준 왼쪽(카메라 오른쪽의 반대)을 향하게 하는 회전각을 구합니다.
   y축으로 각도 θ만큼 돌리면 +x 방향은 (cos θ, 0, -sin θ)가 됩니다 */
function kettleYawFacingScreenLeft() {
  cameraRightDirection.setFromMatrixColumn(camera.matrixWorld, 0);
  cameraRightDirection.y = 0;
  if (cameraRightDirection.lengthSq() < 1e-6) {
    return kettlePivot.rotation.y;
  }
  return Math.atan2(cameraRightDirection.z, -cameraRightDirection.x);
}

function turnKettleTowardScreenLeft(deltaSeconds) {
  let yawDifference = kettleYawFacingScreenLeft() - kettlePivot.rotation.y;
  /* 가까운 쪽으로 돌도록 차이를 -π에서 π 사이로 맞춥니다 */
  yawDifference = THREE.MathUtils.euclideanModulo(yawDifference + Math.PI, FULL_TURN_RADIANS) - Math.PI;
  const maximumTurn = KETTLE_TURN_SPEED_RADIANS_PER_SECOND * deltaSeconds;
  kettlePivot.rotation.y += clamp(yawDifference, -maximumTurn, maximumTurn);
}

function updateKettlePose(deltaSeconds, wantsToPour) {
  turnKettleTowardScreenLeft(deltaSeconds);
  const isHoldingKettle = (selectedTool === "water" || pourState.isAutomaticRunning) && !isBrewFinished();
  if (isHoldingKettle) {
    kettleHeldTarget.set(pourState.kettleTargetX, KETTLE_BODY_HEIGHT, pourState.kettleTargetZ);
    /* 작업대에서 들어 올릴 때는 빨리, 들고 있을 때는 손 속도로 움직입니다 */
    if (kettlePivot.position.y < KETTLE_BODY_HEIGHT - 1) {
      kettlePivot.position.lerp(kettleHeldTarget, 0.2);
    } else {
      moveKettleToward(kettleHeldTarget, deltaSeconds);
    }
  } else {
    kettlePivot.position.lerp(KETTLE_PARKED_BODY, 0.15);
  }

  /* 누르고 있으면 주전자가 천천히 기울고, 어느 정도 기울어야 물이 나오기 시작합니다.
     작업대에서 들어 올리는 중에는 기울이지 않아, 올라가는 속도를 물이 물려받아 위로 튀는 일이 없게 합니다 */
  const isLiftedToHoldingHeight = kettlePivot.position.y > KETTLE_BODY_HEIGHT - 0.3;
  const canPour = isHoldingKettle && wantsToPour && isLiftedToHoldingHeight;
  const tiltChange = deltaSeconds / KETTLE_TILT_SECONDS;
  if (canPour) {
    pourState.tiltProgress = Math.min(1, pourState.tiltProgress + tiltChange);
  } else {
    pourState.tiltProgress = Math.max(0, pourState.tiltProgress - tiltChange);
  }
  kettleTilt.rotation.z = -KETTLE_MAXIMUM_TILT_RADIANS[selectedPourRate] * pourState.tiltProgress;
}

function currentKettleFlow() {
  const flowFraction = clamp((pourState.tiltProgress - KETTLE_FLOW_START_TILT) / (1 - KETTLE_FLOW_START_TILT), 0, 1);
  return FluidBrewModel.pourRates[selectedPourRate] * flowFraction;
}

/* 물 입자가 어디에 닿았는지 판단합니다: 원두 층과 물, 필터 종이, 드리퍼 테두리, 작업대 */
const kettleInverseMatrix = new THREE.Matrix4();
const particleLocalPosition = new THREE.Vector3();
const particleWorldVelocity = new THREE.Vector3();
const kettleSurfaceNormal = new THREE.Vector3();
const kettleWorldQuaternion = new THREE.Quaternion();

/* 물 입자가 주전자 몸통 안으로 들어가면 표면 밖으로 밀어내고, 몸통 쪽으로 향하던 속도는 없앱니다.
   부딪힌 물은 몸통 표면을 타고 흘러내리다 아래로 떨어집니다 */
function keepParticleOutsideKettle(particleIndex) {
  particleLocalPosition.set(
    kettleStream.positionX[particleIndex],
    kettleStream.positionY[particleIndex],
    kettleStream.positionZ[particleIndex]
  ).applyMatrix4(kettleInverseMatrix);
  const localRadius = Math.hypot(particleLocalPosition.x, particleLocalPosition.z);
  const isInsideBody =
    localRadius < KETTLE_BODY_COLLISION_RADIUS &&
    particleLocalPosition.y > KETTLE_BODY_COLLISION_BOTTOM &&
    particleLocalPosition.y < KETTLE_BODY_COLLISION_TOP;
  if (!isInsideBody) {
    return;
  }
  const radialScale = KETTLE_BODY_COLLISION_RADIUS / Math.max(localRadius, 1e-4);
  if (localRadius < 1e-4) {
    particleLocalPosition.x = KETTLE_BODY_COLLISION_RADIUS;
  } else {
    particleLocalPosition.x *= radialScale;
    particleLocalPosition.z *= radialScale;
  }
  kettleSurfaceNormal.set(particleLocalPosition.x, 0, particleLocalPosition.z).normalize();
  particleLocalPosition.applyMatrix4(kettleModel.matrixWorld);
  kettleStream.positionX[particleIndex] = particleLocalPosition.x;
  kettleStream.positionY[particleIndex] = particleLocalPosition.y;
  kettleStream.positionZ[particleIndex] = particleLocalPosition.z;

  kettleModel.getWorldQuaternion(kettleWorldQuaternion);
  kettleSurfaceNormal.applyQuaternion(kettleWorldQuaternion);
  particleWorldVelocity.set(
    kettleStream.velocityX[particleIndex],
    kettleStream.velocityY[particleIndex],
    kettleStream.velocityZ[particleIndex]
  );
  const inwardSpeed = particleWorldVelocity.dot(kettleSurfaceNormal);
  if (inwardSpeed < 0) {
    particleWorldVelocity.addScaledVector(kettleSurfaceNormal, -inwardSpeed);
  }
  kettleStream.velocityX[particleIndex] = particleWorldVelocity.x;
  kettleStream.velocityY[particleIndex] = particleWorldVelocity.y;
  kettleStream.velocityZ[particleIndex] = particleWorldVelocity.z;
}

function landKettleParticle(particleIndex) {
  keepParticleOutsideKettle(particleIndex);
  const worldX = kettleStream.positionX[particleIndex];
  const worldY = kettleStream.positionY[particleIndex];
  const worldZ = kettleStream.positionZ[particleIndex];
  const particleMass = kettleStream.mass[particleIndex];
  const relativeX = worldX - dripperGroup.position.x;
  const relativeZ = worldZ - dripperGroup.position.z;
  const radius = Math.hypot(relativeX, relativeZ);

  if (worldY > PAPER_TOP_HEIGHT) {
    return false;
  }
  if (worldY <= TABLE_HEIGHT) {
    brewModel.addSpilledWater(particleMass);
    spawnSplash(waterSplash, worldX, TABLE_HEIGHT, worldZ, 3, 40);
    return true;
  }

  if (radius < coneRadiusAt(Math.max(0, worldY))) {
    const normalizedX = relativeX / currentBedWorldRadius;
    const normalizedZ = relativeZ / currentBedWorldRadius;
    if (normalizedX * normalizedX + normalizedZ * normalizedZ <= 1) {
      const cellIndex = cellIndexAtNormalized(normalizedX, normalizedZ);
      const surfaceY = bedWorldHeight(cellSnapshot.bedMillimeters[cellIndex]) + cellSnapshot.waterMillimeters[cellIndex] * WATER_MILLIMETER_TO_WORLD;
      if (worldY <= surfaceY) {
        brewModel.addWaterAt(normalizedX, normalizedZ, particleMass);
        spawnSplash(waterSplash, worldX, surfaceY, worldZ, 1, 35);
        spawnRipple(waterRipples, worldX, surfaceY, worldZ, 0.9);
        return true;
      }
    }
    return false;
  }

  /* 원뿔 안쪽에 있던 물이 벽을 넘었다면 필터 종이에 부딪힌 것입니다 */
  if (worldY >= 0 && radius <= coneRadiusAt(PAPER_TOP_HEIGHT) + 0.25) {
    let angle = Math.atan2(relativeZ, relativeX);
    if (angle < 0) {
      angle += FULL_TURN_RADIANS;
    }
    paperModel.addDirectHit(angle, worldY, particleMass * PAPER_DIRECT_HIT_WETNESS_PER_GRAM);
    brewModel.addPaperWater(particleMass);
    spawnSplash(waterSplash, worldX, worldY, worldZ, 1, 25);
    return true;
  }

  /* 드리퍼 테두리에 떨어진 물은 바깥으로 흘러 작업대에 쏟아집니다 */
  if (worldY <= CONE_HEIGHT && radius <= CONE_TOP_RADIUS + 1.8) {
    brewModel.addSpilledWater(particleMass);
    spawnSplash(waterSplash, worldX, CONE_HEIGHT, worldZ, 2, 35);
    return true;
  }
  return false;
}

function updateWater(simulationSeconds, deltaSeconds) {
  let wantsToPour = false;
  if (pourState.isAutomaticRunning) {
    wantsToPour = runAutomaticPouring(simulationSeconds);
  } else if (selectedTool === "water") {
    wantsToPour = pourState.isPointerPouring || pourState.isKeyboardPouring;
  }
  if (isBrewFinished()) {
    wantsToPour = false;
  }
  updateKettlePose(deltaSeconds, wantsToPour);

  const flowGramsPerSecond = currentKettleFlow();
  if (flowGramsPerSecond > 0 && !brewModel.state.isPouring && !isBrewFinished()) {
    brewModel.startPouring();
    lockSettings();
  } else if (flowGramsPerSecond <= 0 && brewModel.state.isPouring) {
    brewModel.stopPouring();
  }

  computeSpoutExit();
  if (!hasPreviousSpoutTip) {
    previousSpoutTip.copy(spoutTipWorld);
    hasPreviousSpoutTip = true;
  }
  kettleStream.advance(simulationSeconds, previousSpoutTip, spoutTipWorld, spoutDirectionWorld, flowGramsPerSecond, landKettleParticle);
  previousSpoutTip.copy(spoutTipWorld);
  updateSplashSystem(waterSplash, simulationSeconds);
  updateRippleSystem(waterRipples, simulationSeconds);

  if (brewModel.state.phase === "brewing") {
    brewModel.advance(simulationSeconds, 0);
    if (brewModel.state.elapsedSeconds >= pourState.nextTimelineSampleSecond) {
      pourState.timelinePoints.push({ second: brewModel.state.elapsedSeconds, grams: brewModel.state.totalPouredGrams });
      pourState.nextTimelineSampleSecond += TIMELINE_SAMPLE_SECONDS;
    }
  }

  let attachPoint = null;
  if (flowGramsPerSecond > 0) {
    attachPoint = spoutTipWorld;
  }
  renderStream(kettleStreamRenderer, kettleStream, attachPoint, null);
}

/* ---------- 드리퍼 아래로 떨어지는 커피 ---------- */

const dripOutlet = new THREE.Vector3();
const dripDirection = new THREE.Vector3(0, -1, 0);
const hangingDropDescription = { x: 0, y: 0, z: 0, radius: 0 };

function serverSurfaceHeight() {
  const coffeeHeight = clamp(dripState.landedGrams / SERVER_CAPACITY_GRAMS, 0, 1) * SERVER_INNER_HEIGHT;
  return TABLE_HEIGHT + 0.3 + coffeeHeight;
}

function landDripParticle(particleIndex) {
  const worldY = dripStream.positionY[particleIndex];
  const surfaceY = serverSurfaceHeight();
  if (worldY > surfaceY) {
    return false;
  }
  dripState.landedGrams += dripStream.mass[particleIndex];
  spawnSplash(coffeeSplash, dripStream.positionX[particleIndex], surfaceY, dripStream.positionZ[particleIndex], 2, 30);
  spawnRipple(coffeeRipples, dripStream.positionX[particleIndex], surfaceY, dripStream.positionZ[particleIndex], 1.4);
  return true;
}

/* 원두 층을 빠져나온 커피(모델이 계산한 양)를 드리퍼 바닥 구멍에서 내보냅니다 */
function updateDrip(simulationSeconds) {
  const beverageGrams = brewModel.state.beverageGrams;
  const newGrams = Math.max(0, beverageGrams - dripState.emittedGrams);
  dripState.emittedGrams = beverageGrams;
  let flowGramsPerSecond = 0;
  if (simulationSeconds > 0) {
    flowGramsPerSecond = newGrams / simulationSeconds;
  }

  dripOutlet.set(dripperGroup.position.x, DRIPPER_OUTLET_HEIGHT, dripperGroup.position.z);
  dripStream.advance(simulationSeconds, previousDripOutlet, dripOutlet, dripDirection, flowGramsPerSecond, landDripParticle);
  previousDripOutlet.copy(dripOutlet);
  updateSplashSystem(coffeeSplash, simulationSeconds);
  updateRippleSystem(coffeeRipples, simulationSeconds);

  hangingDropDescription.x = dripOutlet.x;
  hangingDropDescription.y = dripOutlet.y;
  hangingDropDescription.z = dripOutlet.z;
  hangingDropDescription.radius = dripStream.dropRadiusFor(dripStream.getHangingDropGrams()) * STREAM_VISUAL_SCALE;
  let attachPoint = null;
  if (dripStream.isJetting()) {
    attachPoint = dripOutlet;
  }
  renderStream(dripStreamRenderer, dripStream, attachPoint, hangingDropDescription);
}

/* ---------- 작업대 초기화와 결과 ---------- */

function resetWorkbench() {
  const settings = readSettings();
  settings.finesFraction = finesForCrankSpeed(0);
  brewModel = FluidBrewModel.createBrewModel(settings);
  paperModel = PaperWettingModel.createPaperWettingModel({
    angleSegments: PAPER_ANGLE_SEGMENTS,
    heightRows: PAPER_HEIGHT_ROWS,
    paperHeight: PAPER_TOP_HEIGHT
  });
  createGrinderForDose();

  grindState.groundGrams = 0;
  grindState.finesWeightedSum = 0;
  grindState.isAutomatic = false;
  grindState.crankAngularVelocity = 0;
  grindState.previousPointerAngle = null;
  jarState.grams = 0;
  shakeState.dripperJiggle = 0;
  pourState.isPointerPouring = false;
  pourState.isKeyboardPouring = false;
  pourState.timelinePoints = [{ second: 0, grams: 0 }];
  pourState.nextTimelineSampleSecond = TIMELINE_SAMPLE_SECONDS;
  setAutomaticPouring(false);
  clearFallingParticles();
  kettleStream.reset();
  dripStream.reset();
  clearSplashSystem(waterSplash);
  clearSplashSystem(coffeeSplash);
  clearRippleSystem(waterRipples);
  clearRippleSystem(coffeeRipples);
  hasPreviousSpoutTip = false;
  previousDripOutlet.set(0, DRIPPER_OUTLET_HEIGHT, 0);
  dripState.emittedGrams = 0;
  dripState.landedGrams = 0;
  liquidColorState.streamStrengthPercent = 0;
  liquidColorState.serverStrengthPercent = 0;
  liquidColorState.previousPercolatedGrams = 0;
  liquidColorState.previousBypassGrams = 0;
  pourState.tiltProgress = 0;

  isHeatmapVisible = false;
  lastResult = null;
  resultPanel.hidden = true;
  finishButton.disabled = true;
  unlockSettings();
  updateBedAndWaterMeshes();
  updatePaper(0);
  updateServer();
  updateLiquidColors(0);
  renderBeans();
  renderScale();
  renderTimeline();
  updateChecklist();
}

function completeBrew() {
  if (brewModel.state.phase !== "brewing") {
    return;
  }
  pourState.isPointerPouring = false;
  pourState.isKeyboardPouring = false;
  setAutomaticPouring(false);
  const result = brewModel.finish();
  const score = FluidBrewModel.scoreBrew(result, getTargetTimeRange());
  lastResult = result;
  finishButton.disabled = true;
  recordHistory(result, score);
  renderResult(result, score);
  updateInstruction(true);
}

/* ---------- 권장 순서 체크 (지키지 않아도 되며, 해낸 것만 표시합니다) ---------- */

const checkElements = {};
checklist.querySelectorAll("[data-check]").forEach(function rememberCheck(element) {
  checkElements[element.dataset.check] = element;
});

function setCheck(checkKey, isDone) {
  checkElements[checkKey].classList.toggle("is-done", isDone);
}

function updateChecklist() {
  const doseGrams = readSettings().doseGrams;
  setCheck("grind", grindState.groundGrams >= doseGrams * 0.95);
  setCheck("grounds", brewModel.state.groundsDepositedGrams >= doseGrams * 0.95);

  let bedUnevenness = brewModel.state.initialBedUnevenness;
  if (bedUnevenness === null) {
    bedUnevenness = brewModel.measureBedUnevenness();
  }
  setCheck("level", brewModel.state.groundsDepositedGrams > doseGrams * 0.5 && bedUnevenness < 1.5);

  const meaningfulPours = brewModel.state.pourSegments.filter(function isMeaningful(segment) {
    return segment.grams >= 5;
  });
  let isBloomDone = false;
  const groundsAtFirstPour = brewModel.state.groundsAtFirstPourGrams || 0;
  if (meaningfulPours.length >= 2 && groundsAtFirstPour > 0.5) {
    const bloomRatio = meaningfulPours[0].grams / groundsAtFirstPour;
    const waitSeconds = meaningfulPours[1].startSecond - meaningfulPours[0].endSecond;
    isBloomDone = bloomRatio >= 1.8 && bloomRatio <= 3.6 && waitSeconds >= 20;
  }
  setCheck("bloom", isBloomDone);
  setCheck("pours", meaningfulPours.length >= 3);
}

/* ---------- 안내 문구 ---------- */

let lastInstructionText = "";

function updateInstruction(isForced) {
  let text = TOOL_HINTS[selectedTool];
  if (isBrewFinished()) {
    text = "추출이 끝났습니다. 오른쪽에서 점수와 결과를 보고, 시점을 돌려 원두 층과 필터 종이를 살펴보세요.";
  } else if (selectedTool === "grind") {
    text += " 갈린 원두 " + grindState.groundGrams.toFixed(1) + "g / " + readSettings().doseGrams + "g";
    if (grindState.crankAngularVelocity / FULL_TURN_RADIANS > COMFORTABLE_CRANK_SPEED_ROTATIONS_PER_SECOND + 0.3) {
      text += ". 너무 빨라요! 고운 가루가 늘어납니다.";
    }
  } else if (selectedTool === "grounds") {
    text += " 통 안의 가루 " + jarState.grams.toFixed(1) + "g, 드리퍼 안 " + brewModel.state.groundsDepositedGrams.toFixed(1) + "g";
    if (jarState.grams < 0.05 && grindState.groundGrams < 0.05) {
      text += ". 통이 비어 있습니다. 먼저 원두를 갈아 보세요.";
    }
  } else if (selectedTool === "shake") {
    const flatnessPercent = Math.round(clamp(100 - brewModel.measureBedUnevenness() * 20, 0, 100));
    text += " 평평함 " + flatnessPercent + "%";
  }
  if (isForced || text !== lastInstructionText) {
    stageInstruction.textContent = text;
    lastInstructionText = text;
  }
}

/* ---------- 저울과 그래프 ---------- */

function renderScale() {
  scaleTime.textContent = formatClock(brewModel.state.elapsedSeconds);
  scaleWeight.textContent = brewModel.state.totalPouredGrams.toFixed(1);
  scaleBeverage.textContent = String(Math.round(brewModel.state.beverageGrams));
  renderTargetHint();
}

function renderTargetHint() {
  const schedule = getScaledSchedule();
  if (isBrewFinished()) {
    scaleTarget.textContent = "추출이 끝났습니다.";
    return;
  }
  if (brewModel.state.phase !== "brewing") {
    scaleTarget.innerHTML = "레시피 첫 단계: <b>" + schedule[0].label + "</b>, " + schedule[0].cumulativeGrams + "g까지 붓기";
    return;
  }
  const elapsedSeconds = brewModel.state.elapsedSeconds;
  const pouredGrams = brewModel.state.totalPouredGrams;
  let currentStep = schedule[0];
  let nextStep = null;
  schedule.forEach(function locateSteps(step) {
    if (elapsedSeconds >= step.atSecond) {
      currentStep = step;
    } else if (!nextStep) {
      nextStep = step;
    }
  });
  const remainingGrams = currentStep.cumulativeGrams - pouredGrams;
  if (remainingGrams > 1) {
    scaleTarget.innerHTML =
      "지금: <b>" + currentStep.label + "</b>, " + currentStep.cumulativeGrams + "g까지 " + Math.ceil(remainingGrams) + "g 남음";
  } else if (nextStep) {
    scaleTarget.innerHTML = "기다리기. 다음은 <b>" + formatClock(nextStep.atSecond) + "</b>에 " + nextStep.cumulativeGrams + "g까지";
  } else {
    scaleTarget.textContent = "다 부었습니다. 물이 빠질 때까지 기다리거나 추출 끝내기를 누르세요.";
  }
}

function renderTimeline() {
  const schedule = getScaledSchedule();
  const settings = readSettings();
  const targetWaterGrams = settings.doseGrams * settings.ratio;
  const elapsedSeconds = brewModel.state.elapsedSeconds;
  const timelineWidth = 400;
  const baselineY = 40;
  const usableHeight = 34;
  const maximumSeconds = Math.max(TIMELINE_MINIMUM_SECONDS, elapsedSeconds + 10);
  const maximumGrams = Math.max(targetWaterGrams * 1.1, brewModel.state.totalPouredGrams * 1.05);

  function toX(second) {
    return (second / maximumSeconds) * timelineWidth;
  }
  function toY(grams) {
    return baselineY - (grams / maximumGrams) * usableHeight;
  }

  pourTimeline.textContent = "";
  for (let tickSecond = 30; tickSecond < maximumSeconds; tickSecond += 30) {
    pourTimeline.appendChild(createSvgElement("line", {
      x1: toX(tickSecond), x2: toX(tickSecond), y1: baselineY - 2, y2: baselineY + 2,
      stroke: "var(--color-border)", "stroke-width": 1
    }));
    pourTimeline.appendChild(createSvgElement("text", {
      x: toX(tickSecond), y: 46, "font-size": 7, "text-anchor": "middle", fill: "var(--color-text-muted)"
    }, formatClock(tickSecond)));
  }

  let schedulePath = "M 0 " + toY(0);
  let previousGrams = 0;
  schedule.forEach(function addScheduleStep(step) {
    schedulePath += " L " + toX(step.atSecond) + " " + toY(previousGrams);
    schedulePath += " L " + toX(step.atSecond) + " " + toY(step.cumulativeGrams);
    previousGrams = step.cumulativeGrams;
  });
  schedulePath += " L " + timelineWidth + " " + toY(previousGrams);
  pourTimeline.appendChild(createSvgElement("path", {
    d: schedulePath, fill: "none", stroke: "var(--color-text-muted)", "stroke-width": 1.2,
    "stroke-dasharray": "3 3", "vector-effect": "non-scaling-stroke"
  }));

  if (pourState.timelinePoints.length > 1) {
    const pointList = pourState.timelinePoints
      .map(function toPoint(point) {
        return toX(point.second).toFixed(1) + "," + toY(point.grams).toFixed(1);
      })
      .join(" ");
    pourTimeline.appendChild(createSvgElement("polyline", {
      points: pointList, fill: "none", stroke: "var(--color-water)", "stroke-width": 2.2,
      "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke"
    }));
  }

  pourTimeline.appendChild(createSvgElement("line", {
    x1: toX(elapsedSeconds), x2: toX(elapsedSeconds), y1: 2, y2: baselineY,
    stroke: "var(--color-accent)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke"
  }));
}

/* ---------- 결과 화면 ---------- */

const verdictTexts = {
  "under-weak": "연하고 시큼한 커피",
  "under-ideal": "시큼하고 가벼운 커피",
  "under-strong": "진하지만 시큼한 커피",
  "ideal-weak": "맛은 고르지만 묽은 커피",
  "ideal-ideal": "균형 잡힌 커피",
  "ideal-strong": "맛은 고르지만 진한 커피",
  "over-weak": "묽으면서 쓴 커피",
  "over-ideal": "쓴맛이 도드라지는 커피",
  "over-strong": "진하고 쓴 커피"
};

function buildAdvice(result, settings) {
  const adviceList = [];
  const selectedBean = getSelectedBean();
  const recipe = getSelectedRecipe();

  if (!result.hasCoffee) {
    adviceList.push("그라인더로 원두를 갈고, 가루 통으로 드리퍼에 담은 뒤 물을 부어 보세요.");
    return adviceList;
  }
  if (result.doseGrams < settings.doseGrams * 0.9) {
    adviceList.push(
      "원두를 " + result.doseGrams.toFixed(1) + "g만 담았습니다. 설정한 " + settings.doseGrams + "g보다 적어 물에 비해 원두가 모자랐습니다."
    );
  }

  if (result.bloom.quality === "none" || result.bloom.quality === "skipped") {
    adviceList.push(
      "뜸 들이기가 없거나 짧았습니다(대기 " + Math.round(result.bloom.waitSeconds) + "초). 첫 물을 원두의 2–3배만 붓고 30–45초 기다려 보세요."
    );
  } else if (result.bloom.quality === "no-coffee") {
    adviceList.push("원두를 담기 전에 물부터 부었습니다. 그 물은 원두를 거치지 않고 그대로 서버로 내려갔습니다.");
  } else if (result.bloom.quality === "too-little-water") {
    adviceList.push("뜸 물이 원두의 " + result.bloom.bloomRatio.toFixed(1) + "배로 부족했습니다. 2–3배를 부어 가루 전체를 적셔 주세요.");
  } else if (result.bloom.quality === "too-much-water") {
    adviceList.push("뜸 물이 원두의 " + result.bloom.bloomRatio.toFixed(1) + "배로 많았습니다. 첫 물은 2–3배면 충분합니다.");
  }

  if (result.extractionZone === "under") {
    adviceList.push(
      "덜 우러났습니다. 분쇄를 " + settings.grindSetting + "단계에서 " + Math.max(1, settings.grindSetting - 1) +
      "단계로 가늘게 하거나 물 온도를 2°C 올려 보세요."
    );
  } else if (result.extractionZone === "over") {
    adviceList.push(
      "너무 우러났습니다. 분쇄를 " + settings.grindSetting + "단계에서 " + Math.min(10, settings.grindSetting + 1) +
      "단계로 굵게 하거나 물 온도를 2°C 낮춰 보세요."
    );
  }
  if (result.strengthZone === "weak") {
    adviceList.push("묽습니다. 비율을 1:" + settings.ratio + "에서 1:" + (settings.ratio - 1) + "로 진하게 바꿔 보세요.");
  } else if (result.strengthZone === "strong") {
    adviceList.push("진합니다. 비율을 1:" + settings.ratio + "에서 1:" + (settings.ratio + 1) + "로 연하게 하거나, 마실 때 뜨거운 물을 조금 더하세요.");
  }
  if (result.wallPouredGrams > 10) {
    adviceList.push(
      "물 " + Math.round(result.wallPouredGrams) + "g을 필터 종이에 직접 부었습니다. 종이에 번진 자국이 그 흔적입니다. 가장자리에서 1cm 안쪽까지만 원을 그려 주세요."
    );
  }
  if (result.initialBedUnevenness !== null && result.initialBedUnevenness > 2) {
    adviceList.push("물을 붓기 전 원두 층이 울퉁불퉁했습니다. 가루를 담은 뒤 흔들기 도구로 평평하게 만들어 보세요.");
  }
  if (result.uniformityPercent < 70) {
    adviceList.push("추출 균일도가 " + Math.round(result.uniformityPercent) + "%로 낮습니다. 추출 지도에서 덜 우러난 곳(파란색)을 확인해 보세요.");
  }
  if (result.dryCoffeePercent > 5) {
    adviceList.push("원두의 " + Math.round(result.dryCoffeePercent) + "%가 물에 제대로 젖지 않았습니다.");
  }
  if (result.finesFraction > 0.15) {
    adviceList.push("그라인더를 너무 빨리 돌려 고운 가루가 많이 생겼습니다. 1초에 한 바퀴 정도로 천천히 돌려 보세요.");
  }
  if (result.contactSeconds > 240) {
    adviceList.push("추출이 4분을 넘었습니다. 분쇄가 너무 가늘거나 고운 가루가 많아 물이 잘 빠지지 않았습니다.");
  } else if (result.contactSeconds < 110) {
    adviceList.push("2분이 안 돼서 끝났습니다. 물을 더 천천히, 여러 번에 나눠 부어 보세요.");
  }
  if (result.spilledGrams > 5) {
    adviceList.push("물 " + Math.round(result.spilledGrams) + "g이 드리퍼 밖으로 쏟아졌습니다. 주둥이가 드리퍼 안쪽을 향하도록 주전자를 조금 더 안으로 옮겨 주세요.");
  }
  if (result.leftoverWaterGrams > 5) {
    adviceList.push("드리퍼에 물이 " + Math.round(result.leftoverWaterGrams) + "g 남은 채로 끝냈습니다.");
  }
  if (result.totalPouredGrams < settings.doseGrams * settings.ratio * 0.9) {
    adviceList.push("목표 " + Math.round(settings.doseGrams * settings.ratio) + "g보다 적게 부었습니다.");
  }
  if (selectedBean && Math.abs(settings.temperatureCelsius - recipe.temperatureCelsius) >= 3) {
    adviceList.push(selectedBean.koreanName + "의 추천 온도는 " + recipe.temperatureCelsius + "°C입니다.");
  }
  if (adviceList.length === 0) {
    adviceList.push("레시피 그대로 잘 내렸습니다. 이 설정을 맛 기록에 남겨 두세요.");
  }
  return adviceList;
}

function renderResult(result, score) {
  const settings = readSettings();
  resultPanel.hidden = false;
  isHeatmapVisible = false;
  heatmapButton.setAttribute("aria-pressed", "false");
  heatmapButton.textContent = "원두 층 추출 지도 보기";
  heatmapLegend.hidden = true;

  resultScore.textContent = String(score.totalScore);
  resultReview.textContent = score.oneLineReview;
  scoreBreakdown.textContent = "";
  score.breakdown.forEach(function addBreakdownRow(item) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = item.label;
    const track = document.createElement("span");
    track.className = "score-breakdown-track";
    const fill = document.createElement("span");
    fill.className = "score-breakdown-fill";
    fill.style.display = "block";
    fill.style.width = (item.points / item.maximum) * 100 + "%";
    track.appendChild(fill);
    const points = document.createElement("span");
    points.className = "score-breakdown-points";
    points.textContent = Math.round(item.points) + "/" + item.maximum;
    row.append(label, track, points);
    scoreBreakdown.appendChild(row);
  });

  if (result.hasCoffee) {
    resultVerdict.textContent = verdictTexts[result.extractionZone + "-" + result.strengthZone];
  } else {
    resultVerdict.textContent = "뜨거운 물";
  }
  resultTime.textContent = formatClock(result.contactSeconds);
  resultBeverage.textContent = Math.round(result.beverageGrams) + "g";
  resultExtraction.textContent = result.extractionPercent.toFixed(1) + "%";
  resultStrength.textContent = result.strengthPercent.toFixed(2) + "%";
  resultUniformity.textContent = Math.round(result.uniformityPercent) + "%";
  resultBypass.textContent = Math.round(result.bypassGrams) + "g";

  resultAdvice.textContent = "";
  buildAdvice(result, settings).forEach(function addAdvice(adviceText) {
    const item = document.createElement("li");
    item.textContent = adviceText;
    resultAdvice.appendChild(item);
  });

  const tastingParameters = new URLSearchParams({
    bean: beanSelect.value,
    dose: result.doseGrams.toFixed(1),
    water: String(Math.round(result.totalPouredGrams)),
    temperature: String(settings.temperatureCelsius),
    grind: String(settings.grindSetting),
    time: formatClock(result.contactSeconds)
  });
  sendToTastingLink.href = "tasting.html?" + tastingParameters.toString();

  drawBrewChart(result);
  resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function drawBrewChart(currentResult) {
  const ideal = FluidBrewModel.idealRange;
  const chartLeft = 46;
  const chartRight = 346;
  const chartTop = 12;
  const chartBottom = 206;
  const minimumExtraction = 12;
  const maximumExtraction = 26;
  const minimumStrength = 0.8;
  const maximumStrength = 1.9;

  function toX(extractionPercent) {
    const clamped = clamp(extractionPercent, minimumExtraction, maximumExtraction);
    return chartLeft + ((clamped - minimumExtraction) / (maximumExtraction - minimumExtraction)) * (chartRight - chartLeft);
  }
  function toY(strengthPercent) {
    const clamped = clamp(strengthPercent, minimumStrength, maximumStrength);
    return chartBottom - ((clamped - minimumStrength) / (maximumStrength - minimumStrength)) * (chartBottom - chartTop);
  }

  brewChart.textContent = "";
  brewChart.appendChild(createSvgElement("rect", {
    x: toX(ideal.extractionLow), y: toY(ideal.strengthHigh),
    width: toX(ideal.extractionHigh) - toX(ideal.extractionLow),
    height: toY(ideal.strengthLow) - toY(ideal.strengthHigh),
    fill: "var(--color-good-soft)", stroke: "var(--color-good)", "stroke-width": 1.2
  }));
  for (let extractionTick = 14; extractionTick <= 24; extractionTick += 2) {
    brewChart.appendChild(createSvgElement("line", {
      x1: toX(extractionTick), x2: toX(extractionTick), y1: chartTop, y2: chartBottom,
      stroke: "var(--color-border)", "stroke-width": 0.8, "stroke-dasharray": "2 3"
    }));
    brewChart.appendChild(createSvgElement("text", {
      x: toX(extractionTick), y: chartBottom + 14, "font-size": 10, "text-anchor": "middle", fill: "var(--color-text-muted)"
    }, extractionTick + "%"));
  }
  for (let strengthTick = 1.0; strengthTick <= 1.81; strengthTick += 0.2) {
    brewChart.appendChild(createSvgElement("line", {
      x1: chartLeft, x2: chartRight, y1: toY(strengthTick), y2: toY(strengthTick),
      stroke: "var(--color-border)", "stroke-width": 0.8, "stroke-dasharray": "2 3"
    }));
    brewChart.appendChild(createSvgElement("text", {
      x: chartLeft - 6, y: toY(strengthTick) + 3.5, "font-size": 10, "text-anchor": "end", fill: "var(--color-text-muted)"
    }, strengthTick.toFixed(1)));
  }
  brewChart.appendChild(createSvgElement("rect", {
    x: chartLeft, y: chartTop, width: chartRight - chartLeft, height: chartBottom - chartTop,
    fill: "none", stroke: "var(--color-text-muted)", "stroke-width": 1
  }));
  [
    { x: chartLeft + 6, y: chartTop + 14, anchor: "start", text: "진하고 시큼" },
    { x: chartRight - 6, y: chartTop + 14, anchor: "end", text: "진하고 씀" },
    { x: chartLeft + 6, y: chartBottom - 8, anchor: "start", text: "연하고 시큼" },
    { x: chartRight - 6, y: chartBottom - 8, anchor: "end", text: "연하고 씀" },
    { x: (toX(ideal.extractionLow) + toX(ideal.extractionHigh)) / 2, y: toY(ideal.strengthHigh) - 5, anchor: "middle", text: "균형 범위" }
  ].forEach(function addZoneLabel(zoneLabel) {
    brewChart.appendChild(createSvgElement("text", {
      x: zoneLabel.x, y: zoneLabel.y, "font-size": 11, "text-anchor": zoneLabel.anchor, fill: "var(--color-text-muted)"
    }, zoneLabel.text));
  });
  brewChart.appendChild(createSvgElement("text", {
    x: (chartLeft + chartRight) / 2, y: 242, "font-size": 11, "text-anchor": "middle", fill: "var(--color-text)"
  }, "추출 수율 (얼마나 우러났나)"));
  brewChart.appendChild(createSvgElement("text", {
    x: 12, y: (chartTop + chartBottom) / 2, "font-size": 11, "text-anchor": "middle", fill: "var(--color-text)",
    transform: "rotate(-90 12 " + (chartTop + chartBottom) / 2 + ")"
  }, "농도 TDS %"));

  /* 이전 시도는 흐리게, 이번 결과는 진하게 찍습니다 */
  brewHistory.slice(1).forEach(function plotPreviousAttempt(entry) {
    brewChart.appendChild(createSvgElement("circle", {
      cx: toX(entry.extractionPercent), cy: toY(entry.strengthPercent), r: 4, fill: "var(--color-text-muted)", opacity: 0.35
    }));
  });
  if (currentResult) {
    brewChart.appendChild(createSvgElement("circle", {
      cx: toX(currentResult.extractionPercent), cy: toY(currentResult.strengthPercent), r: 7,
      fill: "var(--color-accent)", stroke: "var(--color-surface)", "stroke-width": 2
    }));
  }
}

function recordHistory(result, score) {
  const settings = readSettings();
  let beanName = "기본 레시피";
  const selectedBean = getSelectedBean();
  if (selectedBean) {
    beanName = selectedBean.koreanName;
  }
  brewHistory.unshift({
    beanName: beanName,
    doseGrams: Number(result.doseGrams.toFixed(1)),
    waterGrams: Math.round(result.totalPouredGrams),
    grindSetting: settings.grindSetting,
    temperatureCelsius: settings.temperatureCelsius,
    contactSeconds: result.contactSeconds,
    extractionPercent: result.extractionPercent,
    strengthPercent: result.strengthPercent,
    uniformityPercent: result.uniformityPercent,
    score: score.totalScore
  });
  brewHistory = brewHistory.slice(0, MAXIMUM_HISTORY_ENTRIES);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  historyList.textContent = "";
  historyEmpty.hidden = brewHistory.length > 0;
  brewHistory.forEach(function addHistoryItem(entry) {
    const item = document.createElement("li");
    const description = document.createElement("span");
    let descriptionText =
      entry.beanName + ", " + entry.doseGrams + "g/" + entry.waterGrams + "g, 분쇄 " + entry.grindSetting + ", " + entry.temperatureCelsius + "°C";
    if (typeof entry.score === "number") {
      descriptionText = entry.score + "점  " + descriptionText;
    }
    description.textContent = descriptionText;
    const numbers = document.createElement("span");
    numbers.textContent =
      formatClock(entry.contactSeconds) + "  수율 " + entry.extractionPercent.toFixed(1) + "%  농도 " + entry.strengthPercent.toFixed(2) + "%";
    item.append(description, numbers);
    historyList.appendChild(item);
  });
}

/* ---------- 도구와 시점 ---------- */

let cameraAnimation = null;

function getCameraTarget() {
  if (orbitControls) {
    return orbitControls.target.clone();
  }
  return DRIPPER_FOCUS.clone();
}

function animateCameraTo(newTarget, newOffset) {
  const currentTarget = getCameraTarget();
  let offset = newOffset;
  if (!offset) {
    offset = camera.position.clone().sub(currentTarget);
  }
  cameraAnimation = {
    progress: 0,
    fromTarget: currentTarget,
    toTarget: newTarget.clone(),
    fromPosition: camera.position.clone(),
    toPosition: newTarget.clone().add(offset)
  };
}

function updateCameraAnimation(deltaSeconds) {
  cameraAnimation.progress = Math.min(1, cameraAnimation.progress + deltaSeconds / CAMERA_ANIMATION_SECONDS);
  const easedProgress = 1 - Math.pow(1 - cameraAnimation.progress, 3);
  const target = cameraAnimation.fromTarget.clone().lerp(cameraAnimation.toTarget, easedProgress);
  camera.position.copy(cameraAnimation.fromPosition).lerp(cameraAnimation.toPosition, easedProgress);
  if (orbitControls) {
    orbitControls.target.copy(target);
  }
  camera.lookAt(target);
  if (cameraAnimation.progress >= 1) {
    cameraAnimation = null;
  }
}

function focusForTool(toolName) {
  if (toolName === "grind") {
    return GRINDER_FOCUS;
  }
  if (toolName === "camera") {
    return null;
  }
  return DRIPPER_FOCUS;
}

function selectTool(toolName) {
  const previousFocus = focusForTool(selectedTool);
  selectedTool = toolName;
  markSegmentPressed(toolSelector, toolSelector.querySelector('[data-tool="' + toolName + '"]'));

  const isCameraTool = toolName === "camera";
  if (orbitControls) {
    orbitControls.mouseButtons = {
      LEFT: isCameraTool ? THREE.MOUSE.ROTATE : DISABLED_CONTROL_ACTION,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    orbitControls.touches = {
      ONE: isCameraTool ? THREE.TOUCH.ROTATE : DISABLED_CONTROL_ACTION,
      TWO: THREE.TOUCH.DOLLY_ROTATE
    };
  }
  viewport.style.cursor = isCameraTool ? "grab" : "crosshair";

  const newFocus = focusForTool(toolName);
  if (newFocus && (!previousFocus || !newFocus.equals(previousFocus))) {
    animateCameraTo(newFocus, null);
  }
  pourState.isPointerPouring = false;
  updateInstruction(true);
}

/* ---------- 입력 이벤트 ---------- */

function isPrimaryPointer(event) {
  return event.pointerType !== "mouse" || event.button === PRIMARY_MOUSE_BUTTON;
}

viewport.addEventListener("pointerdown", function handleViewportPointerDown(event) {
  if (event.target.closest(".segmented")) {
    return;
  }
  activePointerIds.add(event.pointerId);
  /* 두 손가락이나 오른쪽 버튼은 시점 조작으로 씁니다 */
  if (activePointerIds.size > 1 || !isPrimaryPointer(event) || selectedTool === "camera") {
    isPrimaryPointerDown = false;
    pourState.isPointerPouring = false;
    return;
  }
  isPrimaryPointerDown = true;
  if (selectedTool === "grind") {
    grindState.previousPointerAngle = null;
    handleGrindPointer(event);
  } else if (selectedTool === "grounds") {
    handleJarPointer(event);
  } else if (selectedTool === "shake") {
    shakeState.previousX = null;
    handleShakePointer(event);
  } else if (selectedTool === "water") {
    handleWaterPointer(event);
    pourState.isPointerPouring = !isBrewFinished();
  }
});

viewport.addEventListener("pointermove", function handleViewportPointerMove(event) {
  if (activePointerIds.size > 1 || selectedTool === "camera") {
    return;
  }
  if (selectedTool === "grind" && isPrimaryPointerDown) {
    handleGrindPointer(event);
  } else if (selectedTool === "grounds") {
    handleJarPointer(event);
  } else if (selectedTool === "shake") {
    handleShakePointer(event);
  } else if (selectedTool === "water") {
    handleWaterPointer(event);
  }
});

function handleViewportPointerEnd(event) {
  activePointerIds.delete(event.pointerId);
  isPrimaryPointerDown = false;
  pourState.isPointerPouring = false;
  grindState.previousPointerAngle = null;
  grindState.pointerAngularVelocity = 0;
}

viewport.addEventListener("pointerup", handleViewportPointerEnd);
viewport.addEventListener("pointercancel", handleViewportPointerEnd);
viewport.addEventListener("pointerleave", handleViewportPointerEnd);
viewport.addEventListener("contextmenu", function blockContextMenu(event) {
  event.preventDefault();
});

function isTypingTarget(target) {
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA";
}

const toolKeyMap = { Digit1: "grind", Digit2: "grounds", Digit3: "shake", Digit4: "water", Digit5: "camera" };

document.addEventListener("keydown", function handleKeyDown(event) {
  if (isTypingTarget(event.target)) {
    return;
  }
  if (toolKeyMap[event.code]) {
    selectTool(toolKeyMap[event.code]);
    return;
  }
  if (event.code === "Space" && selectedTool === "water") {
    event.preventDefault();
    pourState.isKeyboardPouring = !isBrewFinished();
  }
});

document.addEventListener("keyup", function handleKeyUp(event) {
  if (event.code !== "Space" || isTypingTarget(event.target)) {
    return;
  }
  if (selectedTool === "water") {
    event.preventDefault();
  }
  pourState.isKeyboardPouring = false;
});

setUpSegmentedControl(toolSelector, "tool", selectTool);
setUpSegmentedControl(viewSelector, "view", function selectView(viewName) {
  animateCameraTo(getCameraTarget(), CAMERA_OFFSETS[viewName]);
});
setUpSegmentedControl(pourRateSelector, "rate", function selectPourRate(rate) {
  selectedPourRate = rate;
});
setUpSegmentedControl(speedSelector, "speed", function selectSpeed(speed) {
  selectedSpeed = Number(speed);
});

finishButton.addEventListener("click", function handleFinish() {
  completeBrew();
});

automaticGrindButton.addEventListener("click", function handleAutomaticGrind() {
  if (grinderPhysics.getGroundCount() >= grindState.beanCount) {
    return;
  }
  grindState.isAutomatic = true;
  grindState.automaticStartSecond = sceneClockSeconds;
  selectTool("grind");
});

automaticLoadButton.addEventListener("click", function handleAutomaticLoad() {
  if (isBrewFinished()) {
    return;
  }
  if (jarState.grams < 0.05) {
    stageInstruction.textContent = "가루 통이 비어 있습니다. 먼저 원두를 갈아 주세요.";
    lastInstructionText = stageInstruction.textContent;
    return;
  }
  brewModel.depositGrounds(0, 0, jarState.grams);
  jarState.grams = 0;
  for (let shakeIndex = 0; shakeIndex < 25; shakeIndex += 1) {
    brewModel.shakeDripper();
  }
  selectTool("water");
});

automaticPourButton.addEventListener("click", function handleAutomaticPour() {
  if (isBrewFinished()) {
    return;
  }
  setAutomaticPouring(!pourState.isAutomaticRunning);
  if (pourState.isAutomaticRunning) {
    pourState.automaticAngle = 0;
    selectTool("water");
  }
});

resetButton.addEventListener("click", function handleReset() {
  resetWorkbench();
  selectTool("grind");
});

brewAgainButton.addEventListener("click", function handleBrewAgain() {
  resetWorkbench();
  selectTool("grind");
  viewport.scrollIntoView({ behavior: "smooth", block: "center" });
});

heatmapButton.addEventListener("click", function toggleHeatmap() {
  isHeatmapVisible = !isHeatmapVisible;
  heatmapButton.setAttribute("aria-pressed", String(isHeatmapVisible));
  if (isHeatmapVisible) {
    heatmapButton.textContent = "원래 색으로 보기";
    selectTool("camera");
    animateCameraTo(DRIPPER_FOCUS, CAMERA_OFFSETS.top);
  } else {
    heatmapButton.textContent = "원두 층 추출 지도 보기";
  }
  heatmapLegend.hidden = !isHeatmapVisible;
  updateBedAndWaterMeshes();
});

beanSelect.addEventListener("change", function handleBeanChange() {
  applySelectedRecipe();
  updateSettingLabels();
  resetWorkbench();
});

[doseInput, ratioInput, grindInput, temperatureInput].forEach(function listenToSlider(slider) {
  slider.addEventListener("input", function handleSliderInput() {
    updateSettingLabels();
  });
  /* 원두 양이나 분쇄도가 바뀌면 호퍼의 원두 수와 모델을 새로 만듭니다 */
  slider.addEventListener("change", function handleSliderChange() {
    resetWorkbench();
  });
});

CoffeeSession.onThemeChange(function redrawForTheme() {
  applySceneTheme();
  if (lastResult && !resultPanel.hidden) {
    drawBrewChart(lastResult);
  }
});

/* ---------- 크기 조절과 그리기 루프 ---------- */

function resizeRenderer() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (renderer) {
    renderer.setSize(width, height, false);
  }
  camera.aspect = width / height;
  /* 화면이 좁으면 작업대가 다 보이도록 화각을 넓힙니다 */
  camera.fov = width < height ? 55 : 40;
  camera.updateProjectionMatrix();
}

new ResizeObserver(resizeRenderer).observe(viewport);

let lastFrameTimestamp = null;
let frameCounter = 0;

function animationFrame(timestamp) {
  if (lastFrameTimestamp === null) {
    lastFrameTimestamp = timestamp;
  }
  const deltaSeconds = Math.min(MAXIMUM_FRAME_SECONDS, (timestamp - lastFrameTimestamp) / 1000);
  lastFrameTimestamp = timestamp;
  sceneClockSeconds += deltaSeconds;
  frameCounter += 1;
  const simulationSeconds = deltaSeconds * selectedSpeed;

  updateGrinder(deltaSeconds);
  updateJar(deltaSeconds);
  shakeState.dripperJiggle *= Math.pow(0.02, deltaSeconds);
  dripperGroup.position.x = shakeState.dripperJiggle;

  /* 추출이 끝난 뒤에도 공중에 있던 물방울과 드리퍼에 남은 커피 방울은 마저 떨어집니다 */
  updateWater(simulationSeconds, deltaSeconds);
  updateDrip(simulationSeconds);
  updateFallingParticles(deltaSeconds);
  updateBedAndWaterMeshes();
  updatePaper(isBrewFinished() ? deltaSeconds : simulationSeconds);
  updateServer();
  updateLiquidColors(simulationSeconds);

  if (!isBrewFinished()) {
    finishButton.disabled = brewModel.state.totalPouredGrams <= 0;
    if (brewModel.isNaturallyComplete() && kettleStream.getAliveCount() === 0) {
      completeBrew();
    }
  }

  /* 글자와 그래프는 매 프레임 바꿀 필요가 없어 몇 프레임에 한 번만 갱신합니다 */
  if (frameCounter % TEXT_REFRESH_FRAME_INTERVAL === 0) {
    renderScale();
    renderTimeline();
    updateChecklist();
    updateInstruction(false);
  }

  if (cameraAnimation) {
    updateCameraAnimation(deltaSeconds);
  } else if (orbitControls) {
    orbitControls.update();
  }
  /* 화면을 그리지 못하는 환경에서도 마우스 위치 계산이 맞도록 카메라 행렬을 갱신합니다 */
  camera.updateMatrixWorld();
  if (renderer) {
    renderer.render(scene, camera);
  }
  window.requestAnimationFrame(animationFrame);
}

/* ---------- 시작 ---------- */

populateBeanSelect();
applySelectedRecipe();
updateSettingLabels();
renderHistory();
resetWorkbench();
selectTool("grind");
resizeRenderer();
window.requestAnimationFrame(animationFrame);

/* 자동 시험에서 상태를 읽을 수 있도록 내부 상태 일부를 열어 둡니다 */
CoffeeSession.simulatorDebug = {
  getBrewModel: function getBrewModel() {
    return brewModel;
  },
  getGrindState: function getGrindState() {
    return grindState;
  },
  getJarState: function getJarState() {
    return jarState;
  },
  getHighestWaterAboveSpout: function getHighestWaterAboveSpout() {
    let highest = -Infinity;
    for (let particleIndex = 0; particleIndex < kettleStream.maximumParticles; particleIndex += 1) {
      if (kettleStream.isAlive[particleIndex]) {
        highest = Math.max(highest, kettleStream.positionY[particleIndex] - spoutTipWorld.y);
      }
    }
    return highest;
  },
  countWaterInsideKettle: function countWaterInsideKettle() {
    let insideCount = 0;
    const inverse = new THREE.Matrix4().copy(kettleModel.matrixWorld).invert();
    const localPoint = new THREE.Vector3();
    for (let particleIndex = 0; particleIndex < kettleStream.maximumParticles; particleIndex += 1) {
      if (!kettleStream.isAlive[particleIndex]) {
        continue;
      }
      localPoint.set(kettleStream.positionX[particleIndex], kettleStream.positionY[particleIndex], kettleStream.positionZ[particleIndex]).applyMatrix4(inverse);
      if (Math.hypot(localPoint.x, localPoint.z) < KETTLE_BODY_COLLISION_RADIUS - 0.05 && localPoint.y > KETTLE_BODY_COLLISION_BOTTOM + 0.05 && localPoint.y < KETTLE_BODY_COLLISION_TOP - 0.05) {
        insideCount += 1;
      }
    }
    return insideCount;
  },
  getStreamRenderStats: function getStreamRenderStats() {
    let oldestKettleParticleSeconds = 0;
    for (let particleIndex = 0; particleIndex < kettleStream.maximumParticles; particleIndex += 1) {
      if (kettleStream.isAlive[particleIndex]) {
        oldestKettleParticleSeconds = Math.max(oldestKettleParticleSeconds, kettleStream.age[particleIndex]);
      }
    }
    return {
      kettleLongestLink: kettleStreamRenderer.longestLink,
      oldestKettleParticleSeconds: oldestKettleParticleSeconds,
      kettleTubeIndexes: kettleStreamRenderer.tubeGeometry.drawRange.count,
      kettleDrops: kettleStreamRenderer.dropMesh.count,
      dripTubeIndexes: dripStreamRenderer.tubeGeometry.drawRange.count,
      dripDrops: dripStreamRenderer.dropMesh.count
    };
  },
  /* 화면에 실제로 그려지는 물줄기 관의 정점 범위를 주둥이 위치와 비교하기 위한 값 */
  getKettleTubeBounds: function getKettleTubeBounds() {
    const geometry = kettleStreamRenderer.tubeGeometry;
    const indexes = geometry.getIndex().array;
    const positions = geometry.getAttribute("position").array;
    const bounds = { minimumY: Infinity, maximumY: -Infinity, highestVertex: null, spoutTip: spoutTipWorld.toArray() };
    for (let indexPosition = 0; indexPosition < geometry.drawRange.count; indexPosition += 1) {
      const vertexOffset = indexes[indexPosition] * 3;
      const vertexY = positions[vertexOffset + 1];
      bounds.minimumY = Math.min(bounds.minimumY, vertexY);
      if (vertexY > bounds.maximumY) {
        bounds.maximumY = vertexY;
        bounds.highestVertex = [positions[vertexOffset], vertexY, positions[vertexOffset + 2], indexes[indexPosition]];
      }
    }
    return bounds;
  },
  getStreamState: function getStreamState() {
    return {
      kettleParticles: kettleStream.getAliveCount(),
      dripParticles: dripStream.getAliveCount(),
      hangingDropGrams: dripStream.getHangingDropGrams(),
      serverLandedGrams: dripState.landedGrams,
      kettleTilt: pourState.tiltProgress,
      kettleBody: kettlePivot.position.toArray(),
      spoutTip: spoutTipWorld.toArray()
    };
  },
  getPaperWetness: function getPaperWetness(angleIndex, rowIndex) {
    return paperModel.readWetness(angleIndex, rowIndex);
  },
  getCameraPosition: function getCameraPosition() {
    return camera.position.toArray();
  },
  worldToScreen: function worldToScreen(worldX, worldY, worldZ) {
    const projected = new THREE.Vector3(worldX, worldY, worldZ).project(camera);
    const bounds = viewport.getBoundingClientRect();
    return {
      x: bounds.left + ((projected.x + 1) / 2) * bounds.width,
      y: bounds.top + ((1 - projected.y) / 2) * bounds.height
    };
  },
  selectTool: selectTool
};
