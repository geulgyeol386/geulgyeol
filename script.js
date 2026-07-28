const REQUEST_STORAGE_KEY = "geulgyeolRequestsV51";

const REQUEST_DB_NAME = "geulgyeolRequestDatabase";
const REQUEST_DB_VERSION = 1;
const REQUEST_STORE_NAME = "requests";

function openRequestDatabase() {
  return new Promise(function (resolve, reject) {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not supported"));
      return;
    }

    const request = indexedDB.open(REQUEST_DB_NAME, REQUEST_DB_VERSION);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(REQUEST_STORE_NAME)) {
        db.createObjectStore(REQUEST_STORE_NAME, { keyPath: "storageId", autoIncrement: true });
      }
    };

    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error || new Error("Database open failed")); };
  });
}

async function addRequestToDatabase(data) {
  const db = await openRequestDatabase();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(REQUEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(REQUEST_STORE_NAME);
    const request = store.add(data);
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
    tx.oncomplete = function () { db.close(); };
    tx.onerror = function () { db.close(); };
  });
}

async function getAllRequestsFromDatabase() {
  const db = await openRequestDatabase();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(REQUEST_STORE_NAME, "readonly");
    const store = tx.objectStore(REQUEST_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = function () {
      const rows = request.result || [];
      rows.sort(function (a, b) { return (b.storageId || 0) - (a.storageId || 0); });
      resolve(rows);
    };
    request.onerror = function () { reject(request.error); };
    tx.oncomplete = function () { db.close(); };
    tx.onerror = function () { db.close(); };
  });
}

async function getRequestFromDatabase(storageId) {
  const db = await openRequestDatabase();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(REQUEST_STORE_NAME, "readonly");
    const request = tx.objectStore(REQUEST_STORE_NAME).get(Number(storageId));
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
    tx.oncomplete = function () { db.close(); };
    tx.onerror = function () { db.close(); };
  });
}

async function clearRequestDatabase() {
  const db = await openRequestDatabase();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(REQUEST_STORE_NAME, "readwrite");
    const request = tx.objectStore(REQUEST_STORE_NAME).clear();
    request.onsuccess = function () { resolve(); };
    request.onerror = function () { reject(request.error); };
    tx.oncomplete = function () { db.close(); };
    tx.onerror = function () { db.close(); };
  });
}

async function migrateLegacyRequests() {
  try {
    const legacy = JSON.parse(localStorage.getItem(REQUEST_STORAGE_KEY) || "[]");
    if (!Array.isArray(legacy) || legacy.length === 0) return;

    const current = await getAllRequestsFromDatabase();
    if (current.length > 0) return;

    for (let index = legacy.length - 1; index >= 0; index -= 1) {
      await addRequestToDatabase(legacy[index]);
    }
    localStorage.removeItem(REQUEST_STORAGE_KEY);
  } catch (error) {
    console.warn("기존 저장 자료 이전을 건너뜁니다.", error);
  }
}

let currentAiSuggestion = "";
let currentAiWorkType = "";
let currentAiRefineText = "";
let aiGenerationCount = 0;
let aiRefinementCount = 0;
let aiSelectedCandidate = 0;
let aiLastRefinement = "";
let referenceImageData1 = "";
let referenceImageData2 = "";

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("requestForm");
  const modal = document.getElementById("imageModal");

  if (form) {
    form.addEventListener("submit", saveRequest);
  }

  const storyField = document.getElementById("requestStory");
  if (storyField) {
    storyField.addEventListener("input", updateStoryCount);
    updateStoryCount();
  }

  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        closeImage();
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeImage();
    }
  });

  const refineClose = document.getElementById("aiRefineClose");
  if (refineClose) refineClose.addEventListener("click", closeAiRefinePanel);

  const refineButton = document.getElementById("aiRefineButton");
  if (refineButton) refineButton.addEventListener("click", function () { refineAiSuggestion(); });

  document.querySelectorAll("[data-refine]").forEach(function (button) {
    button.addEventListener("click", function () {
      const input = document.getElementById("aiRefineInstruction");
      if (input) input.value = button.getAttribute("data-refine") || "";
      refineAiSuggestion(button.getAttribute("data-refine") || "");
    });
  });

  document.querySelectorAll("[data-sentence-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      setSentenceMode(button.getAttribute("data-sentence-mode") || "");
    });
  });

  checkAiConnection();
  setupRevealAnimation();
  migrateLegacyRequests().then(renderSavedRequests);
});


async function checkAiConnection() {
  const notice = document.getElementById("aiConnectionStatus");
  const button = document.getElementById("aiGenerateButton");
  if (!notice) return;
  try {
    const response = await fetch("/api/ai/status", { cache: "no-store" });
    const result = await response.json();
    if (result.configured) {
      notice.textContent = "AI 연결 준비가 완료되었습니다.";
      notice.className = "ai-connection-status is-ready";
    } else {
      notice.textContent = "AI 연결 전입니다. Railway Variables에 OPENAI_API_KEY를 등록하면 바로 사용할 수 있습니다.";
      notice.className = "ai-connection-status is-waiting";
      if (button) button.title = "OPENAI_API_KEY 등록 후 사용할 수 있습니다.";
    }
  } catch {
    notice.textContent = "AI 연결 상태는 실제 업로드 후 확인됩니다.";
    notice.className = "ai-connection-status is-waiting";
  }
}

function showMessage(text, type) {
  const message = document.getElementById("formMessage");

  if (!message) {
    alert(text);
    return;
  }

  message.textContent = text;
  message.className = "form-message " + (type || "");
}

function setSentenceMode(mode) {
  const method = document.getElementById("sentenceMethod");
  const directPanel = document.getElementById("directSentencePanel");
  const aiPanel = document.getElementById("aiRecommendationPanel");
  const aiCheckbox = document.getElementById("useAiRecommendation");

  if (method) method.value = mode;
  if (directPanel) directPanel.hidden = mode !== "direct";
  if (aiPanel) aiPanel.hidden = mode !== "ai";
  if (aiCheckbox) aiCheckbox.checked = mode === "ai";

  document.querySelectorAll("[data-sentence-mode]").forEach(function (button) {
    const active = button.getAttribute("data-sentence-mode") === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  if (mode === "direct") {
    currentAiSuggestion = "";
    const chosen = document.getElementById("chosenSentence");
    if (chosen) chosen.focus();
  } else if (mode === "ai") {
    const emphasis = document.getElementById("aiEmphasis");
    if (emphasis) emphasis.focus();
  }
}

function toggleAiRecommendation() {
  const checkbox = document.getElementById("useAiRecommendation");
  setSentenceMode(checkbox && checkbox.checked ? "ai" : "direct");
}

function countSentenceCharacters(text) {
  return (text || "").replace(/\s/g, "").length;
}

function getSelectedAiLengthRange() {
  const selected = document.querySelector('input[name="aiLengthRange"]:checked');
  return selected ? selected.value : "short";
}

function getAiLengthSetting(range) {
  const settings = {
    short: { label: "30자 미만", price: "10,000원", min: 1, max: 29 },
    medium: { label: "30~60자", price: "20,000원", min: 30, max: 59 },
    long: { label: "60~100자", price: "30,000원", min: 60, max: 99 },
    veryLong: { label: "100자 이상", price: "50,000원", min: 100, max: Number.POSITIVE_INFINITY }
  };
  return settings[range] || settings.short;
}

function updateStoryCount() {
  const story = document.getElementById("requestStory");
  const counter = document.getElementById("storyCount");
  if (!story || !counter) return;
  counter.textContent = story.value.length + " / 500자";
}

function inferWorkTypeFromStory(story) {
  const text = (story || "").toLowerCase();
  if (/가훈|좌우명|교훈|집안.*글|가족.*뜻/.test(text)) return "가훈";
  if (/청첩|결혼.*초대|예식.*초대|혼인.*초대/.test(text)) return "청첩장";
  if (/입춘|입춘대길|건양다경/.test(text)) return "입춘첩";
  if (/연하|새해|신년|설날/.test(text)) return "연하장";
  if (/감사|고마움|퇴임|퇴직|은퇴|스승|선생님/.test(text)) return "감사의 글";
  if (/축하|손주|출산|돌|생일|승진|개업|합격|입학|졸업/.test(text)) return "축하글";
  if (/액자|걸어두|벽에|작품으로/.test(text)) return "액자";
  return "기타";
}

function getAiRequestContext() {
  const storyElement = document.getElementById("requestStory");
  return {
    storyElement,
    story: storyElement ? storyElement.value.trim() : "",
    recipient: getValue("recipient"),
    writingMood: getValue("writingMood") || "함께 상의",
    workType: getValue("workType"),
    range: getSelectedAiLengthRange(),
    emphasis: getValue("aiEmphasis"),
    preferredStyle: getValue("aiPreferredStyle") || "다양하게"
  };
}

async function requestAiSuggestions(payload, loadingText) {
  const suggestionBox = document.getElementById("aiSuggestion");
  if (!suggestionBox) throw new Error("AI 결과 영역을 찾을 수 없습니다.");
  suggestionBox.innerHTML = `<div class="ai-loading">${escapeHtml(loadingText)}</div>`;

  const response = await fetch("/api/ai/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(result.error || "AI 문구를 만들지 못했습니다.");
  return result;
}

function renderAiSuggestions(result, mode) {
  const suggestionBox = document.getElementById("aiSuggestion");
  const setting = getAiLengthSetting(getSelectedAiLengthRange());
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
  if (!suggestionBox || suggestions.length === 0) throw new Error("AI가 추천 문구를 반환하지 않았습니다.");

  currentAiWorkType = getValue("workType") || result.workType || inferWorkTypeFromStory(getValue("requestStory"));
  window.generatedAiSuggestions = suggestions;

  const purpose = result.purposeSummary
    ? `<p class="ai-purpose-summary">AI 판단: <strong>${escapeHtml(currentAiWorkType)}</strong> · ${escapeHtml(result.purposeSummary)}</p>`
    : `<p class="ai-purpose-summary">AI 판단 작품 유형: <strong>${escapeHtml(currentAiWorkType)}</strong></p>`;
  const heading = mode === "refine"
    ? '<div class="ai-result-heading"><strong>선택한 뜻을 살린 수정안 3개</strong><span>마음에 드는 문구를 다시 다듬어도 됩니다.</span></div>'
    : '<div class="ai-result-heading"><strong>서로 다른 방향의 추천 문구 5개</strong><span>각 문구는 선택하거나 다시 다듬을 수 있습니다.</span></div>';

  suggestionBox.innerHTML = purpose + heading + suggestions.map(function (item, index) {
    const sentence = typeof item === "string" ? item : (item.text || "");
    const label = typeof item === "object" && item.label ? item.label : `추천 ${index + 1}`;
    const count = countSentenceCharacters(sentence);
    const isInRange = count >= setting.min && count <= setting.max;
    return `
      <div class="ai-suggestion-card">
        <div class="ai-suggestion-number">${index + 1}</div>
        <div class="ai-suggestion-content">
          <strong class="ai-suggestion-label">${escapeHtml(label)}</strong>
          <p>${escapeHtml(sentence)}</p>
          <small class="${isInRange ? "range-ok" : "range-note"}">공백 제외 ${count}자 · 희망 ${setting.label} · 기본비용 ${setting.price}</small>
        </div>
        <div class="ai-card-actions">
          <button type="button" data-ai-use="${index}">이 문구 사용</button>
          <button type="button" class="secondary" data-ai-refine="${index}">이 문구 다듬기</button>
        </div>
      </div>`;
  }).join("") + (mode === "initial" ? '<button id="aiGenerateAgain" type="button" class="ai-generate-again">새로운 문구 5개 다시 만들기</button>' : '');

  suggestionBox.querySelectorAll("[data-ai-use]").forEach(function (button) {
    button.addEventListener("click", function () { useAiSuggestion(Number(button.getAttribute("data-ai-use"))); });
  });
  suggestionBox.querySelectorAll("[data-ai-refine]").forEach(function (button) {
    button.addEventListener("click", function () { openAiRefinePanel(Number(button.getAttribute("data-ai-refine"))); });
  });
  const again = document.getElementById("aiGenerateAgain");
  if (again) again.addEventListener("click", makeRequestSentence);
}

async function makeRequestSentence() {
  const suggestionBox = document.getElementById("aiSuggestion");
  const checkbox = document.getElementById("useAiRecommendation");
  const panel = document.getElementById("aiRecommendationPanel");
  const button = document.getElementById("aiGenerateButton");
  const context = getAiRequestContext();

  if (!context.storyElement || !suggestionBox) {
    showMessage("페이지 연결에 문제가 있습니다. 새 파일로 교체한 뒤 다시 실행해 주세요.", "error");
    return;
  }
  if (checkbox && !checkbox.checked) checkbox.checked = true;
  if (panel) panel.hidden = false;
  if (!context.story) {
    showMessage("먼저 ‘전하고 싶은 마음과 사연’을 적어주세요.", "error");
    context.storyElement.focus();
    return;
  }

  currentAiSuggestion = "";
  currentAiWorkType = "";
  aiSelectedCandidate = 0;
  closeAiRefinePanel();
  if (button) { button.disabled = true; button.textContent = "AI가 5개 문구를 만들고 있습니다…"; }

  try {
    const result = await requestAiSuggestions({ mode: "initial", ...context }, "AI가 사연의 뜻과 강조할 핵심을 살펴보고 있습니다…");
    aiGenerationCount += 1;
    renderAiSuggestions(result, "initial");
    showMessage("서로 다른 방향의 맞춤 문구 5개를 만들었습니다. 문구를 선택하거나 더 다듬어 보세요.", "success");
  } catch (error) {
    console.error(error);
    suggestionBox.innerHTML = `<div class="ai-error">${escapeHtml(error.message || "AI 문구 추천 중 오류가 발생했습니다.")}</div>`;
    showMessage(error.message || "AI 문구 추천 중 오류가 발생했습니다.", "error");
  } finally {
    if (button) { button.disabled = false; button.textContent = "서로 다른 문구 5개 만들기"; }
  }
}

function useAiSuggestion(index) {
  const chosenSentence = document.getElementById("chosenSentence");
  const suggestions = window.generatedAiSuggestions || [];
  const selectedItem = suggestions[index];
  const selected = typeof selectedItem === "string" ? selectedItem : (selectedItem && selectedItem.text);
  if (!selected) {
    showMessage("먼저 AI 맞춤 문구를 만들어 주세요.", "error");
    return;
  }
  if (!chosenSentence) return;
  currentAiSuggestion = selected;
  aiSelectedCandidate = index + 1;
  chosenSentence.value = selected;
  chosenSentence.dispatchEvent(new Event("input", { bubbles: true }));

  const directPanel = document.getElementById("directSentencePanel");
  if (directPanel) directPanel.hidden = false;
  const directLabel = directPanel ? directPanel.querySelector(".preferred-sentence > span") : null;
  if (directLabel) directLabel.textContent = "최종 사용할 문구";

  chosenSentence.focus();
  chosenSentence.scrollIntoView({ behavior: "smooth", block: "center" });
  showMessage("선택한 문구를 최종 문구 입력란에 넣었습니다. 그대로 사용하거나 자유롭게 고쳐주세요.", "success");
}

function openAiRefinePanel(index) {
  const suggestions = window.generatedAiSuggestions || [];
  const item = suggestions[index];
  const text = typeof item === "string" ? item : (item && item.text);
  const panel = document.getElementById("aiRefinePanel");
  const base = document.getElementById("aiRefineBase");
  if (!text || !panel || !base) return;
  currentAiRefineText = text;
  base.textContent = `“${text}”`;
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const input = document.getElementById("aiRefineInstruction");
  if (input) input.focus();
}

function closeAiRefinePanel() {
  const panel = document.getElementById("aiRefinePanel");
  if (panel) panel.hidden = true;
}

async function refineAiSuggestion(preset) {
  const context = getAiRequestContext();
  const instructionInput = document.getElementById("aiRefineInstruction");
  const button = document.getElementById("aiRefineButton");
  const instruction = String(preset || (instructionInput ? instructionInput.value : "")).trim() || "핵심 뜻을 유지하면서 더 자연스럽고 작품성 있게";
  if (!currentAiRefineText) {
    showMessage("먼저 추천 문구에서 ‘이 문구 다듬기’를 선택해 주세요.", "error");
    return;
  }
  if (button) { button.disabled = true; button.textContent = "수정안을 만드는 중…"; }
  try {
    const result = await requestAiSuggestions({ mode: "refine", ...context, selectedText: currentAiRefineText, refinement: instruction }, "선택한 문구의 뜻을 유지하며 수정안을 만들고 있습니다…");
    aiRefinementCount += 1;
    aiLastRefinement = instruction;
    renderAiSuggestions(result, "refine");
    closeAiRefinePanel();
    showMessage("선택한 문구를 바탕으로 수정안 3개를 만들었습니다. 다시 다듬기도 가능합니다.", "success");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "문구를 다듬는 중 오류가 발생했습니다.", "error");
  } finally {
    if (button) { button.disabled = false; button.textContent = "수정안 3개 만들기"; }
  }
}

function previewReferenceImage(number, input) {
  const preview = document.getElementById("referencePreview" + number);

  if (!input || !input.files || !input.files[0]) {
    if (preview) {
      preview.innerHTML = "<span>이미지를 선택해 주세요.</span>";
    }

    if (number === 1) {
      referenceImageData1 = "";
    } else {
      referenceImageData2 = "";
    }
    return;
  }

  const file = input.files[0];

  if (!file.type.startsWith("image/")) {
    showMessage("이미지 파일만 선택할 수 있습니다.", "error");
    input.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = function (event) {
    const imageData = event.target.result;

    if (number === 1) {
      referenceImageData1 = imageData;
    } else {
      referenceImageData2 = imageData;
    }

    if (preview) {
      preview.innerHTML = `
        <img src="${imageData}" alt="참고 이미지 ${number}">
        <button type="button" onclick="removeReferenceImage(${number})">삭제</button>
      `;
    }

    showMessage("참고 이미지 " + number + "을 추가했습니다.", "success");
  };

  reader.readAsDataURL(file);
}

function removeReferenceImage(number) {
  const input = document.getElementById("referenceImage" + number);
  const preview = document.getElementById("referencePreview" + number);

  if (input) {
    input.value = "";
  }

  if (preview) {
    preview.innerHTML = "<span>이미지를 선택해 주세요.</span>";
  }

  if (number === 1) {
    referenceImageData1 = "";
  } else {
    referenceImageData2 = "";
  }
}

function referenceImagePrintBlock(data) {
  const image1 = data && data.referenceImage1 !== undefined
    ? data.referenceImage1
    : referenceImageData1;
  const image2 = data && data.referenceImage2 !== undefined
    ? data.referenceImage2
    : referenceImageData2;

  if (!image1 && !image2) {
    return `
      <div class="print-reference-section no-images">
        <h4>참고 이미지</h4>
        <div class="print-reference-empty">첨부된 참고 이미지가 없습니다.</div>
      </div>
    `;
  }

  return `
    <div class="print-reference-section">
      <h4>참고 이미지</h4>
      <div class="print-reference-grid">
        ${image1
          ? `<div class="print-reference-image"><img src="${image1}" alt="참고 이미지 1"></div>`
          : `<div class="print-reference-placeholder">참고 이미지 1 없음</div>`}
        ${image2
          ? `<div class="print-reference-image"><img src="${image2}" alt="참고 이미지 2"></div>`
          : `<div class="print-reference-placeholder">참고 이미지 2 없음</div>`}
      </div>
    </div>
  `;
}

function getValue(id) {
  const element = document.getElementById(id);
  return element ? element.value.trim() : "";
}

function getFormData() {
  const checkbox = document.getElementById("useAiRecommendation");

  return {
    createdAt: new Date().toLocaleString("ko-KR"),
    name: getValue("customerName"),
    phone: getValue("customerPhone"),
    email: getValue("customerEmail"),
    workType: getValue("workType") || currentAiWorkType || inferWorkTypeFromStory(getValue("requestStory")),
    workShape: getValue("workShape"),
    workSize: getValue("workSize"),
    writingMood: getValue("writingMood"),
    dueDate: getValue("dueDate"),
    recipient: getValue("recipient"),
    story: getValue("requestStory"),
    sentence: getValue("chosenSentence"),
    sentenceMethod: getValue("sentenceMethod") || "direct",
    usedAi: checkbox ? checkbox.checked : false,
    aiLengthRange: getSelectedAiLengthRange(),
    aiPreferredStyle: getValue("aiPreferredStyle"),
    aiEmphasis: getValue("aiEmphasis"),
    aiGenerationCount: aiGenerationCount,
    aiRefinementCount: aiRefinementCount,
    aiSelectedCandidate: aiSelectedCandidate,
    aiLastRefinement: aiLastRefinement,
    sentenceCharacterCount: countSentenceCharacters(getValue("chosenSentence")),
    extra: getValue("extraRequest"),
    referenceImage1: referenceImageData1 || "",
    referenceImage2: referenceImageData2 || ""
  };
}

function validateRequest() {
  const form = document.getElementById("requestForm");
  const consent = document.getElementById("privacyConsent");

  if (!form) {
    showMessage("의뢰서 양식을 찾을 수 없습니다.", "error");
    return false;
  }

  const requiredFields = [
    { id: "customerName", label: "성함" },
    { id: "customerPhone", label: "연락처" },
    { id: "workType", label: "작품 종류" },
    { id: "requestStory", label: "전하고 싶은 마음과 사연" }
  ];

  for (const field of requiredFields) {
    const element = document.getElementById(field.id);

    if (!element || !element.value.trim()) {
      showMessage("‘" + field.label + "’ 항목을 입력해 주세요.", "error");

      if (element) {
        element.focus();
      }

      return false;
    }
  }

  const sentenceMethod = getValue("sentenceMethod");
  const chosenSentence = getValue("chosenSentence");

  if (!sentenceMethod) {
    showMessage("문구 작성 방법을 먼저 선택해 주세요.", "error");
    const firstButton = document.getElementById("directSentenceButton");
    if (firstButton) firstButton.focus();
    return false;
  }

  if (!chosenSentence) {
    showMessage(sentenceMethod === "ai" ? "AI 추천 문구 중 최종 문구를 선택해 주세요." : "원하는 문구를 입력해 주세요.", "error");
    const target = sentenceMethod === "ai" ? document.getElementById("aiGenerateButton") : document.getElementById("chosenSentence");
    if (target) target.focus();
    return false;
  }

  if (consent && !consent.checked) {
    showMessage("정보 사용 동의에 체크해 주세요.", "error");
    consent.focus();
    return false;
  }

  return true;
}


function getPrintDensityClass(data) {
  const totalLength =
    (data.story || "").length +
    (data.sentence || "").length +
    (data.extra || "").length;

  if (totalLength <= 180) {
    return "print-density-relaxed";
  }

  if (totalLength <= 360) {
    return "print-density-normal";
  }

  if (totalLength <= 560) {
    return "print-density-compact";
  }

  return "print-density-tight";
}

function applyPrintDensity(data) {
  const preview = document.getElementById("requestPreview");
  if (!preview) return;

  preview.classList.remove(
    "print-density-relaxed",
    "print-density-normal",
    "print-density-compact",
    "print-density-tight"
  );

  const densityClass = getPrintDensityClass(data);
  preview.classList.add(densityClass);

  if (densityClass === "print-density-tight") {
    showMessage(
      "입력 내용이 많아 참고 이미지 영역을 자동으로 줄였습니다. 인쇄 미리보기에서 한 장인지 확인해 주세요.",
      "success"
    );
  }
}

function previewRequest() {
  if (!validateRequest()) return;

  const data = getFormData();
  showRequestPreview(data, true);
}

function showRequestPreview(data, shouldScroll) {
  applyPrintDensity(data);

  const preview = document.getElementById("requestPreview");
  const content = document.getElementById("previewContent");

  if (!preview || !content) {
    showMessage("내용 확인 화면을 찾을 수 없습니다.", "error");
    return;
  }

  content.innerHTML = `
    <div class="print-sheet">
      <div class="print-title">
        <h2>글결 작업 의뢰서</h2>
        <p>당신의 마음을 AI가 다듬고, 묵향을 담은 손글씨가 정성을 다해 전합니다.</p>
      </div>

      <div class="print-info-grid">
        ${printInfo("작성일", data.createdAt || new Date().toLocaleDateString("ko-KR"))}
        ${printInfo("성함", data.name)}
        ${printInfo("연락처", data.phone)}
        ${printInfo("이메일", data.email || "미입력")}
        ${printInfo("작품 유형", data.workType || "미분류")}
        ${printInfo("전하는 대상", data.recipient || "미입력")}
        ${printInfo("작품 형태", data.workShape || "함께 상의")}
        ${printInfo("희망 크기", data.workSize || "함께 상의")}
        ${printInfo("글씨 분위기", data.writingMood || "함께 상의")}
        ${printInfo("희망 완료일", data.dueDate || "함께 상의")}
        ${printInfo("문구 작성 방식", data.usedAi ? "AI와 함께 작성" : "직접 작성")}
        ${printInfo("최종 문구 글자 수", (data.sentenceCharacterCount || countSentenceCharacters(data.sentence)) + "자 (공백 제외)")}
        ${printInfo("기본 제작비", getBasePrice(data.workSize, data.sentence))}
      </div>

      <div class="print-section">
        <h4>전하고 싶은 마음과 사연</h4>
        <p>${escapeHtml(data.story || "")}</p>
      </div>

      <div class="print-section">
        <h4>고객이 선택한 최종 문구</h4>
        <p class="final-sentence">${escapeHtml(data.sentence || "함께 상의")}</p>
      </div>

      <div class="print-section compact-section">
        <h4>추가로 전하고 싶은 내용</h4>
        <p>${escapeHtml(data.extra || "없음")}</p>
      </div>

      ${referenceImagePrintBlock(data)}

      <div class="print-footer-row">
        <div>
          <strong>진행 체크</strong><br>
          □ 상담완료　□ 문구확정　□ 작업완료　□ 고객확인　□ 포장　□ 발송
        </div>
        <div class="print-sign">글결 __________________</div>
      </div>
    </div>
  `;

  preview.hidden = false;

  showMessage("글결 작업 의뢰서를 아래에서 확인하고 다시 출력할 수 있습니다.", "success");

  if (shouldScroll) {
    setTimeout(function () {
      preview.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }
}

function getBasePrice(workSize, sentence) {
  let sizePrice = 10000;
  const size = workSize || "";

  if (size.includes("신문지 한 면보다 큰")) sizePrice = 50000;
  else if (size.includes("절반 초과")) sizePrice = 30000;
  else if (size.includes("A4 ~")) sizePrice = 20000;

  const count = countSentenceCharacters(sentence || "");
  let characterPrice = 10000;
  if (count >= 100) characterPrice = 50000;
  else if (count >= 60) characterPrice = 30000;
  else if (count >= 30) characterPrice = 20000;

  return Math.max(sizePrice, characterPrice).toLocaleString("ko-KR") + "원";
}

function printInfo(label, value) {
  return `
    <div class="print-info-item">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

function previewItem(label, value, full) {
  return `
    <div class="preview-item ${full ? "full" : ""}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

async function saveRequest(event) {
  event.preventDefault();

  if (!validateRequest()) return;

  const data = getFormData();

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error("서버 저장 실패");
    const saved = await response.json();
    const localCopy = { ...data, storageId: saved.storageId, id: saved.id || data.id };
    try { await addRequestToDatabase(localCopy); } catch (localError) { console.warn("이 기기 사본 저장 실패", localError); }

    showMessage(
      "의뢰 내용을 글결 서버에 접수했습니다. 주문번호를 꼭 기억해 주세요: " + (saved.id || data.id),
      "success"
    );

    previewRequest();
    await renderSavedRequests();
  } catch (error) {
    console.error(error);

    showMessage(
      "의뢰 내용을 저장하지 못했습니다. 브라우저의 시크릿 모드를 종료하거나 저장 공간 허용 여부를 확인해 주세요.",
      "error"
    );
  }
}

function printRequest() {
  const preview = document.getElementById("requestPreview");
  const content = document.getElementById("previewContent");

  if (!preview || preview.hidden || !content || !content.innerHTML.trim()) {
    previewRequest();
  }

  if (!preview || preview.hidden || !content || !content.innerHTML.trim()) return;

  const densityClass = [
    "print-density-relaxed",
    "print-density-normal",
    "print-density-compact",
    "print-density-tight"
  ].find(function (name) {
    return preview.classList.contains(name);
  }) || "print-density-normal";

  const printWindow = window.open("", "_blank", "width=980,height=900");

  if (!printWindow) {
    alert("인쇄 창이 차단되었습니다. 브라우저 주소창 오른쪽의 팝업 차단을 허용한 뒤 다시 눌러 주세요.");
    return;
  }

  const printCss = `
    @page {
      size: A4 portrait;
      margin: 18mm 12mm 14mm 22mm;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #171717;
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      width: 176mm;
      min-height: 265mm;
      font-size: 10.6pt;
      line-height: 1.42;
    }

    .print-sheet {
      width: 176mm;
      height: 265mm;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .print-title {
      margin: 0 0 6mm;
      padding: 0 0 4mm;
      border-bottom: 2px solid #2d2924;
      flex: 0 0 auto;
    }

    .print-title h2 {
      margin: 0;
      font-size: 22pt;
      line-height: 1.15;
      letter-spacing: -0.8px;
      font-weight: 800;
    }

    .print-title p {
      margin: 2mm 0 0;
      font-size: 9.5pt;
      line-height: 1.35;
      color: #555;
    }

    .print-info-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      border-top: 1px solid #777;
      border-left: 1px solid #777;
      flex: 0 0 auto;
    }

    .print-info-item {
      display: grid;
      grid-template-columns: 29mm minmax(0, 1fr);
      min-height: 8.5mm;
      border-right: 1px solid #777;
      border-bottom: 1px solid #777;
    }

    .print-info-item strong,
    .print-info-item span {
      display: flex;
      align-items: center;
      padding: 1.3mm 1.8mm;
      font-size: 9.8pt;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .print-info-item strong {
      background: #f1ece3;
      border-right: 1px solid #777;
      font-weight: 700;
    }

    .print-section,
    .print-reference-section {
      margin-top: 4mm;
      border: 1px solid #777;
      flex: 0 0 auto;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .print-section h4,
    .print-reference-section h4 {
      margin: 0;
      padding: 1.8mm 2.2mm;
      background: #f1ece3;
      border-bottom: 1px solid #777;
      font-size: 11.2pt;
      line-height: 1.2;
      font-weight: 800;
    }

    .print-section p {
      margin: 0;
      min-height: 15mm;
      max-height: 27mm;
      overflow: hidden;
      padding: 2.5mm 3mm;
      font-size: 10.5pt;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .print-section .final-sentence {
      min-height: 14mm;
      max-height: 24mm;
      font-size: 12.5pt;
      line-height: 1.5;
      font-weight: 700;
    }

    .compact-section p {
      min-height: 11mm;
      max-height: 18mm;
    }

    .print-reference-section {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 39mm;
    }

    .print-reference-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 3mm;
      padding: 3mm;
      flex: 1 1 auto;
      min-height: 0;
    }

    .print-reference-image,
    .print-reference-placeholder {
      min-height: 34mm;
      height: 100%;
      border: 1px solid #999;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #fff;
    }

    .print-reference-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .print-reference-empty {
      padding: 3mm;
      font-size: 9.5pt;
      color: #666;
      text-align: center;
    }

    .print-footer-row {
      margin-top: 4mm;
      padding-top: 3mm;
      border-top: 1px solid #777;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 5mm;
      font-size: 9.3pt;
      line-height: 1.45;
      flex: 0 0 auto;
    }

    .print-sign { min-width: 45mm; text-align: right; }

    .print-density-relaxed .print-reference-section { min-height: 66mm; }
    .print-density-normal .print-reference-section { min-height: 52mm; }
    .print-density-compact .print-reference-section { min-height: 40mm; }
    .print-density-tight .print-reference-section { min-height: 30mm; }

    .print-density-compact .print-section p {
      min-height: 12mm;
      max-height: 22mm;
      font-size: 10pt;
      line-height: 1.42;
    }

    .print-density-tight .print-title { margin-bottom: 4mm; padding-bottom: 3mm; }
    .print-density-tight .print-title h2 { font-size: 20pt; }
    .print-density-tight .print-info-item { min-height: 7.5mm; }
    .print-density-tight .print-info-item strong,
    .print-density-tight .print-info-item span { padding: 1mm 1.5mm; font-size: 9.2pt; }
    .print-density-tight .print-section,
    .print-density-tight .print-reference-section { margin-top: 2.7mm; }
    .print-density-tight .print-section h4,
    .print-density-tight .print-reference-section h4 { padding: 1.3mm 2mm; font-size: 10.5pt; }
    .print-density-tight .print-section p {
      min-height: 9mm;
      max-height: 17mm;
      padding: 1.5mm 2.3mm;
      font-size: 9.2pt;
      line-height: 1.35;
    }
    .print-density-tight .print-section .final-sentence {
      min-height: 9mm;
      max-height: 15mm;
      font-size: 10.5pt;
    }
    .print-density-tight .compact-section p { min-height: 7mm; max-height: 11mm; }
    .print-density-tight .print-footer-row { margin-top: 2.5mm; padding-top: 2mm; font-size: 8.7pt; }

    @media screen {
      body { margin: 18mm auto; box-shadow: 0 0 18px rgba(0,0,0,.16); }
      .print-sheet { outline: 1px solid #ddd; }
    }

    @media print {
      html, body { width: 176mm; height: 265mm; }
      body { margin: 0; box-shadow: none; }
    }
  `;

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="ko">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>글결 작업 의뢰서 인쇄</title>
        <style>${printCss}</style>
      </head>
      <body class="${densityClass}">
        ${content.innerHTML}
      </body>
    </html>`);
  printWindow.document.close();

  const startPrint = function () {
    printWindow.focus();
    printWindow.print();
  };

  const images = Array.from(printWindow.document.images || []);
  if (images.length === 0 || images.every(function (img) { return img.complete; })) {
    setTimeout(startPrint, 250);
  } else {
    let remaining = images.filter(function (img) { return !img.complete; }).length;
    const done = function () {
      remaining -= 1;
      if (remaining <= 0) setTimeout(startPrint, 250);
    };
    images.forEach(function (img) {
      if (!img.complete) {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }
    });
  }
}

async function renderSavedRequests() {
  const list = document.getElementById("savedRequestList");

  if (!list) return;

  try {
    const requests = await getAllRequestsFromDatabase();

    if (requests.length === 0) {
      list.innerHTML = '<p class="empty-message">저장된 의뢰가 없습니다.</p>';
      return;
    }

    list.innerHTML = requests.map(function (request) {
      return `
        <button type="button" class="saved-item saved-item-button" onclick="openSavedRequest(${request.storageId})">
          <h4>${escapeHtml(request.workType)} · ${escapeHtml(request.name)}</h4>
          <p>${escapeHtml(request.createdAt)} / ${escapeHtml(request.phone)}</p>
          <p>${escapeHtml(request.sentence || request.story)}</p>
          <span class="saved-reprint-guide">눌러서 의뢰서 확인 · 다시 출력</span>
        </button>
      `;
    }).join("");
  } catch (error) {
    console.error(error);
    list.innerHTML = '<p class="empty-message">저장 목록을 불러오지 못했습니다.</p>';
  }
}

async function openSavedRequest(storageId) {
  try {
    const request = await getRequestFromDatabase(storageId);

    if (!request) {
      showMessage("선택한 의뢰를 찾을 수 없습니다.", "error");
      return;
    }

    referenceImageData1 = request.referenceImage1 || "";
    referenceImageData2 = request.referenceImage2 || "";

    showRequestPreview(request, true);
  } catch (error) {
    console.error(error);
    showMessage("저장된 의뢰서를 불러오지 못했습니다.", "error");
  }
}

async function clearSavedRequests() {
  if (!confirm("이 컴퓨터에 저장된 의뢰를 모두 삭제할까요?")) return;

  try {
    await clearRequestDatabase();
    localStorage.removeItem(REQUEST_STORAGE_KEY);
    await renderSavedRequests();
    showMessage("저장된 의뢰를 모두 삭제했습니다.", "success");
  } catch (error) {
    console.error(error);
    showMessage("저장된 의뢰를 삭제하지 못했습니다.", "error");
  }
}

function openImage(imagePath, caption) {
  const modal = document.getElementById("imageModal");
  const image = document.getElementById("modalImage");
  const text = document.getElementById("modalCaption");

  if (!modal || !image || !text) return;

  image.src = imagePath;
  image.alt = caption;
  text.textContent = caption;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeImage() {
  const modal = document.getElementById("imageModal");

  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setupRevealAnimation() {
  const revealItems = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window)) {
    revealItems.forEach(function (item) {
      item.classList.add("show");
    });
    return;
  }

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("show");
      }
    });
  }, { threshold: 0.12 });

  revealItems.forEach(function (item) {
    observer.observe(item);
  });
}
