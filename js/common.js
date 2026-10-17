/* 모든 페이지에 들어가는 상단 바, 이전/다음 안내, 하단 정보, 테마 전환, 퀴즈 동작.
   페이지 목록을 한곳에서 관리해서 페이지를 추가하거나 순서를 바꿀 때 이 파일만 고치면 됩니다. */

(function setUpCommonLayout() {
  const THEME_STORAGE_KEY = "coffee-session-theme";
  /* 배포할 때마다 바뀌는 판 번호. 화면 맨 아래에 보여 주어, 브라우저가 예전 파일을 쓰고 있는지 확인할 수 있게 합니다 */
  const SITE_VERSION = "20261017c";

  const sitePages = [
    { file: "index.html", title: "홈", longTitle: "커피 세션 홈" },
    { file: "basics.html", title: "드립 입문", longTitle: "드립커피 입문" },
    { file: "beans.html", title: "이번 원두", longTitle: "이번 원두 가이드" },
    { file: "simulator.html", title: "시뮬레이터", longTitle: "드립 시뮬레이터" },
    { file: "tasting.html", title: "맛 기록", longTitle: "맛 보고 기록하기" }
  ];

  const currentPageFile = document.body.dataset.page;
  const currentPageIndex = sitePages.findIndex(function matchesCurrent(page) {
    return page.file === currentPageFile;
  });

  /* ---------- 테마 ---------- */

  const themeChangeListeners = [];

  window.CoffeeSession = window.CoffeeSession || {};
  window.CoffeeSession.onThemeChange = function onThemeChange(listener) {
    themeChangeListeners.push(listener);
  };

  function readSavedTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY);
    } catch (storageError) {
      return null;
    }
  }

  function saveTheme(themeName) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeName);
    } catch (storageError) {
      /* 저장이 막힌 브라우저에서도 현재 화면에서는 테마가 바뀌도록 그냥 넘어갑니다 */
    }
  }

  function isDarkThemeActive() {
    const forcedTheme = document.documentElement.getAttribute("data-theme");
    if (forcedTheme) {
      return forcedTheme === "dark";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function applyTheme(themeName) {
    if (themeName) {
      document.documentElement.setAttribute("data-theme", themeName);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    updateThemeToggleIcon();
    themeChangeListeners.forEach(function notifyListener(listener) {
      listener();
    });
  }

  const savedTheme = readSavedTheme();
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
  }

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function handleSystemThemeChange() {
    if (!document.documentElement.getAttribute("data-theme")) {
      applyTheme(null);
    }
  });

  /* ---------- 상단 바 ---------- */

  const sunIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const moonIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  /* 드리퍼를 위에서 내려다본 모양을 단순화한 로고 */
  const brandMark =
    '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">' +
    '<path d="M5 8h22l-8 15h-6z" fill="var(--color-text)"/>' +
    '<rect x="11" y="23" width="10" height="3" rx="1.5" fill="var(--color-text)"/>' +
    '<circle cx="16" cy="13" r="3" fill="var(--color-accent)"/></svg>';

  const topBar = document.createElement("header");
  topBar.className = "top-bar";

  const pageLinksMarkup = sitePages
    .map(function buildPageLink(page) {
      const currentAttribute = page.file === currentPageFile ? ' aria-current="page"' : "";
      return '<a href="' + page.file + '"' + currentAttribute + ">" + page.title + "</a>";
    })
    .join("");

  topBar.innerHTML =
    '<div class="top-bar-inner">' +
    '<a class="brand" href="index.html">' + brandMark + "<span>커피 세션</span></a>" +
    '<nav class="page-links" aria-label="페이지 이동">' + pageLinksMarkup + "</nav>" +
    '<button type="button" class="theme-toggle" aria-label="밝은/어두운 화면 전환"></button>' +
    "</div>";

  document.body.prepend(topBar);

  const themeToggleButton = topBar.querySelector(".theme-toggle");

  function updateThemeToggleIcon() {
    if (isDarkThemeActive()) {
      themeToggleButton.innerHTML = sunIcon;
    } else {
      themeToggleButton.innerHTML = moonIcon;
    }
  }

  updateThemeToggleIcon();

  themeToggleButton.addEventListener("click", function toggleTheme() {
    let nextTheme = "dark";
    if (isDarkThemeActive()) {
      nextTheme = "light";
    }
    saveTheme(nextTheme);
    applyTheme(nextTheme);
  });

  /* ---------- 이전 / 다음 ---------- */

  const mainContent = document.querySelector("main");
  if (mainContent && currentPageIndex >= 0) {
    const pager = document.createElement("nav");
    pager.className = "page-pager";
    pager.setAttribute("aria-label", "이전 페이지와 다음 페이지");

    const previousPage = sitePages[currentPageIndex - 1];
    const nextPage = sitePages[currentPageIndex + 1];
    let pagerMarkup = "";

    if (previousPage) {
      pagerMarkup +=
        '<a href="' + previousPage.file + '"><span class="pager-direction">이전</span>' +
        '<span class="pager-title">' + previousPage.longTitle + "</span></a>";
    }
    if (nextPage) {
      pagerMarkup +=
        '<a class="pager-next" href="' + nextPage.file + '"><span class="pager-direction">다음</span>' +
        '<span class="pager-title">' + nextPage.longTitle + "</span></a>";
    }

    pager.innerHTML = pagerMarkup;
    mainContent.appendChild(pager);
  }

  /* ---------- 하단 ---------- */

  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML =
    "<p>사내 커피 동호회 커피 세션<br>원두: Champ de Mars Coffee Roasting Lab</p>" +
    "<p>시뮬레이터 수치는 이해를 돕기 위한 근사 모델이며 실제 측정값과 다를 수 있습니다.</p>" +
    "<p>판 " + SITE_VERSION + "</p>";
  document.body.appendChild(footer);

  /* ---------- 퀴즈 ---------- */

  document.querySelectorAll(".quiz").forEach(function setUpQuiz(quizElement) {
    const optionButtons = quizElement.querySelectorAll(".quiz-options button");
    const explanation = quizElement.querySelector(".quiz-explanation");

    optionButtons.forEach(function setUpOption(optionButton) {
      optionButton.addEventListener("click", function revealAnswer() {
        optionButtons.forEach(function markOption(button) {
          button.disabled = true;
          if (button.dataset.correct === "true") {
            button.classList.add("is-correct");
          }
        });
        if (optionButton.dataset.correct !== "true") {
          optionButton.classList.add("is-wrong");
        }
        if (explanation) {
          explanation.hidden = false;
        }
      });
    });
  });
})();
