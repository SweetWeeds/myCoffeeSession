/* 이번에 구매한 원두 정보와 추천 레시피.
   원두 가이드 페이지, 시뮬레이터, 테이스팅 기록 페이지가 모두 이 데이터를 함께 씁니다.
   컵노트는 산지와 가공 방식에서 일반적으로 기대되는 맛을 정리한 참고값이라,
   봉투 라벨에 적힌 로스터 컵노트와 다르면 라벨을 우선합니다. */

window.CoffeeSession = window.CoffeeSession || {};

window.CoffeeSession.beans = [
  {
    id: "yemen-mocha-mattari",
    koreanName: "예멘 모카 마타리",
    englishName: "Yemen Mocha Mattari",
    nickname: "반 고흐가 사랑했다고 전해지는 커피",
    labelBackground: "linear-gradient(160deg, #2f4a6b 0%, #3f5f7c 45%, #d9a93a 100%)",
    labelTextColor: "#ffffff",
    accentColor: "#c1922e",
    origin: "예멘 바니 마타르 지역",
    variety: "예메니아 (재래종)",
    process: "내추럴 (건식)",
    altitude: "약 1,800–2,200m",
    flavorNotes: ["건포도", "다크 초콜릿", "와인", "향신료"],
    tasteProfile: { acidity: 2, sweetness: 4, body: 5, aroma: 3 },
    description:
      "커피가 처음 세계로 퍼져 나간 모카 항구의 이름을 그대로 쓰는 원두입니다. " +
      "건조한 산지에서 열매째 말리는 전통 방식이라 과일을 졸인 듯한 단맛과 묵직한 바디, " +
      "흙과 향신료 같은 야생적인 향이 함께 납니다. 산미가 강한 커피가 부담스러운 분께 첫 잔으로 좋습니다.",
    brewingTip:
      "다른 원두보다 물 온도를 2–3°C 낮추면 쓴맛과 탄 향이 줄고 초콜릿 같은 단맛이 살아납니다. " +
      "비율을 1:15로 조금 진하게 잡아야 특유의 묵직함이 느껴집니다.",
    extractionOffset: 0.5,
    recipe: {
      doseGrams: 15,
      ratio: 15,
      temperatureCelsius: 90,
      grindSetting: 5,
      targetTimeText: "2:30–2:50",
      schedule: [
        { atSecond: 0, cumulativeGrams: 35, label: "뜸 들이기" },
        { atSecond: 40, cumulativeGrams: 110, label: "1차 붓기" },
        { atSecond: 75, cumulativeGrams: 170, label: "2차 붓기" },
        { atSecond: 105, cumulativeGrams: 225, label: "3차 붓기" }
      ]
    }
  },
  {
    id: "costa-rica-finca-bu",
    koreanName: "코스타리카 따라주 핀카 부 카투아이",
    englishName: "Costa Rica Tarrazú Finca Bu Catuaí",
    nickname: "2024·2025 2년 연속 COE 1위 (봉투 표기)",
    labelBackground: "#f6ebcc",
    labelTextColor: "#3b3226",
    accentColor: "#d8b75c",
    origin: "코스타리카 따라주",
    variety: "카투아이",
    process: "봉투 라벨 확인",
    altitude: "약 1,600–1,900m",
    flavorNotes: ["꿀", "오렌지", "붉은 사과", "밀크 초콜릿"],
    tasteProfile: { acidity: 3, sweetness: 5, body: 3, aroma: 4 },
    description:
      "따라주는 코스타리카에서 가장 높은 해발고도로 유명한 산지입니다. " +
      "COE(Cup of Excellence)는 나라별 품평회에서 수십 번의 블라인드 테이스팅을 거쳐 순위를 매기는 대회로, " +
      "이 농장은 2년 연속 1위를 했다고 소개되어 있습니다. 단맛과 산미의 균형이 깔끔해서 " +
      "레시피를 바꿔 가며 비교하기 좋은 기준점 같은 원두입니다.",
    brewingTip:
      "균형이 좋은 원두라 기본 레시피(1:16, 92–93°C)를 그대로 쓰는 것을 권합니다. " +
      "레시피 하나만 바꿔 가며 맛 차이를 느껴 보는 연습용으로 가장 좋습니다.",
    extractionOffset: -0.1,
    recipe: {
      doseGrams: 15,
      ratio: 16,
      temperatureCelsius: 93,
      grindSetting: 5,
      targetTimeText: "2:30–3:00",
      schedule: [
        { atSecond: 0, cumulativeGrams: 40, label: "뜸 들이기" },
        { atSecond: 40, cumulativeGrams: 120, label: "1차 붓기" },
        { atSecond: 75, cumulativeGrams: 180, label: "2차 붓기" },
        { atSecond: 105, cumulativeGrams: 240, label: "3차 붓기" }
      ]
    }
  },
  {
    id: "ethiopia-alo-tamiru",
    koreanName: "에티오피아 알로 타미루 컬렉션 G1 시다모 델라 내추럴",
    englishName: "Ethiopia Alo Tamiru Collection G1 Sidamo Dela Natural",
    nickname: "2021 에티오피아 COE 1위 생산자의 컬렉션",
    labelBackground: "linear-gradient(140deg, #8f72d6 0%, #c58ccf 55%, #f08a8a 100%)",
    labelTextColor: "#ffffff",
    accentColor: "#a77bd2",
    origin: "에티오피아 시다마(시다모) 벤사 지역",
    variety: "에티오피아 재래종 (74158 계열)",
    process: "내추럴",
    altitude: "약 2,200–2,400m",
    flavorNotes: ["블루베리", "딸기잼", "자스민", "열대 과일"],
    tasteProfile: { acidity: 4, sweetness: 4, body: 3, aroma: 5 },
    description:
      "알로(Alo)는 2021년 에티오피아 COE에서 1위를 한 생산자 타미루 타데세의 농장 이름입니다. " +
      "아주 높은 산지에서 자라 콩이 단단하고, 열매째 말린 내추럴 가공이라 " +
      "잼 같은 베리류 단맛과 화사한 꽃 향이 진하게 올라옵니다.",
    brewingTip:
      "콩이 단단하고 밝게 볶은 편이라 잘 우러나지 않을 수 있습니다. " +
      "물 온도를 93–94°C로 높게, 분쇄는 기본보다 한 칸 가늘게 하고, 뜸은 45초로 충분히 들여 주세요.",
    extractionOffset: -0.6,
    recipe: {
      doseGrams: 15,
      ratio: 16,
      temperatureCelsius: 94,
      grindSetting: 4,
      targetTimeText: "2:50–3:10",
      schedule: [
        { atSecond: 0, cumulativeGrams: 45, label: "뜸 들이기" },
        { atSecond: 45, cumulativeGrams: 120, label: "1차 붓기" },
        { atSecond: 80, cumulativeGrams: 180, label: "2차 붓기" },
        { atSecond: 110, cumulativeGrams: 240, label: "3차 붓기" }
      ]
    }
  },
  {
    id: "colombia-el-paraiso",
    koreanName: "콜롬비아 엘 파라이소 리치 피치",
    englishName: "Colombia El Paraíso Lychee Peach",
    nickname: "무산소 발효와 열충격 가공으로 과일 향을 키운 커피",
    labelBackground: "#16a9cf",
    labelTextColor: "#ffffff",
    accentColor: "#16a9cf",
    origin: "콜롬비아 카우카 엘 파라이소 농장",
    variety: "카스티요",
    process: "더블 무산소 발효 + 열충격(Thermal Shock)",
    altitude: "약 1,900–2,000m",
    flavorNotes: ["리치", "백도", "청포도", "꽃 향"],
    tasteProfile: { acidity: 3, sweetness: 5, body: 3, aroma: 5 },
    description:
      "산소를 차단한 탱크에서 두 번 발효하고, 뜨거운 물과 차가운 물을 번갈아 써서 " +
      "향을 콩 안에 가두는 실험적인 가공을 거친 원두입니다. " +
      "봉투를 여는 순간부터 리치와 복숭아 향이 확 퍼집니다. 커피에 익숙하지 않은 분도 쉽게 즐길 수 있습니다.",
    brewingTip:
      "향 성분이 잘 우러나는 원두라 온도를 89–90°C로 낮추고 분쇄는 한 칸 굵게 해 주세요. " +
      "뜨겁게 내리면 향이 무거워질 수 있습니다. 얼음 위에 바로 내리는 아이스 드립과도 잘 어울립니다.",
    extractionOffset: 0.9,
    recipe: {
      doseGrams: 15,
      ratio: 16,
      temperatureCelsius: 90,
      grindSetting: 6,
      targetTimeText: "2:10–2:30",
      schedule: [
        { atSecond: 0, cumulativeGrams: 40, label: "뜸 들이기" },
        { atSecond: 35, cumulativeGrams: 140, label: "1차 붓기" },
        { atSecond: 75, cumulativeGrams: 240, label: "2차 붓기" }
      ]
    }
  },
  {
    id: "ethiopia-gesha-village",
    koreanName: "에티오피아 게샤빌리지 셰와 지바부 고리게이샤 내추럴",
    englishName: "Ethiopia Gesha Village Shewa-Jibabu Gori Gesha Natural",
    nickname: "게이샤 품종이 처음 발견된 숲 근처에서 온 커피",
    labelBackground: "linear-gradient(180deg, #2a2340 0%, #4a3f6b 50%, #2a2340 100%)",
    labelTextColor: "#ffffff",
    accentColor: "#5b4b8a",
    origin: "에티오피아 서남부 벤치 마지(웨스트 오모), 게샤빌리지 셰와 지바부 구역",
    variety: "고리 게이샤",
    process: "내추럴",
    altitude: "약 1,900–2,100m",
    flavorNotes: ["살구", "자스민", "목련·인동꽃", "화이트 와인"],
    tasteProfile: { acidity: 4, sweetness: 4, body: 2, aroma: 5 },
    description:
      "게이샤(Gesha)는 파나마에서 유명해진 품종이지만 원래 이름은 에티오피아의 게샤 숲에서 왔습니다. " +
      "게샤빌리지는 그 숲 근처에서 야생 게이샤를 다시 모아 키우는 농장이고, " +
      "고리 게이샤는 그중 고리 숲에서 채집한 계통입니다. 가볍고 투명한 질감 위로 꽃과 살구 향이 길게 남습니다.",
    brewingTip:
      "이번 원두 중 가장 귀한 원두라 특별한 모임 날을 위해 아껴 두는 것을 권합니다. " +
      "물을 조금 많이(1:16.5) 써서 가볍게 내리고, 물줄기를 가늘게 유지해 향이 날아가지 않게 해 주세요. " +
      "뜨거울 때보다 살짝 식었을 때 향이 더 잘 느껴집니다.",
    extractionOffset: -0.3,
    recipe: {
      doseGrams: 15,
      ratio: 16.5,
      temperatureCelsius: 93,
      grindSetting: 5,
      targetTimeText: "2:40–3:00",
      schedule: [
        { atSecond: 0, cumulativeGrams: 40, label: "뜸 들이기" },
        { atSecond: 40, cumulativeGrams: 100, label: "1차 붓기" },
        { atSecond: 70, cumulativeGrams: 160, label: "2차 붓기" },
        { atSecond: 100, cumulativeGrams: 210, label: "3차 붓기" },
        { atSecond: 125, cumulativeGrams: 248, label: "4차 붓기" }
      ]
    }
  }
];

/* 원두를 고르지 않았을 때 쓰는 입문용 기본 레시피 */
window.CoffeeSession.basicRecipe = {
  doseGrams: 15,
  ratio: 16,
  temperatureCelsius: 92,
  grindSetting: 5,
  targetTimeText: "2:30–3:00",
  schedule: [
    { atSecond: 0, cumulativeGrams: 40, label: "뜸 들이기" },
    { atSecond: 40, cumulativeGrams: 120, label: "1차 붓기" },
    { atSecond: 75, cumulativeGrams: 180, label: "2차 붓기" },
    { atSecond: 105, cumulativeGrams: 240, label: "3차 붓기" }
  ]
};

window.CoffeeSession.findBeanById = function findBeanById(beanId) {
  return window.CoffeeSession.beans.find(function matchesId(bean) {
    return bean.id === beanId;
  });
};

/* 분쇄도 1–10 단계를 사람이 이해하기 쉬운 말로 바꿉니다 */
window.CoffeeSession.describeGrindSetting = function describeGrindSetting(grindSetting) {
  if (grindSetting <= 2) {
    return "아주 가늘게 (밀가루에 가까움)";
  }
  if (grindSetting <= 4) {
    return "조금 가늘게 (고운 설탕)";
  }
  if (grindSetting <= 6) {
    return "중간 (굵은 설탕)";
  }
  if (grindSetting <= 8) {
    return "조금 굵게 (굵은 소금)";
  }
  return "아주 굵게 (빵가루)";
};
