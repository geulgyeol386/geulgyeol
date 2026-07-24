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
let referenceImageData1 = "";
let referenceImageData2 = "";

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("requestForm");
  const modal = document.getElementById("imageModal");

  if (form) {
    form.addEventListener("submit", saveRequest);
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

  setupRevealAnimation();
  migrateLegacyRequests().then(renderSavedRequests);
});

function showMessage(text, type) {
  const message = document.getElementById("formMessage");

  if (!message) {
    alert(text);
    return;
  }

  message.textContent = text;
  message.className = "form-message " + (type || "");
}

function toggleAiRecommendation() {
  const checkbox = document.getElementById("useAiRecommendation");
  const panel = document.getElementById("aiRecommendationPanel");

  if (!checkbox || !panel) return;

  panel.hidden = !checkbox.checked;

  if (!checkbox.checked) {
    currentAiSuggestion = "";

    const suggestion = document.getElementById("aiSuggestion");
    if (suggestion) {
      suggestion.textContent = "참고 문구가 이곳에 표시됩니다.";
    }
  }
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

function buildAiSuggestions(range, recipient) {
  const prefix = recipient ? recipient + "께, " : "";
  const groups = {
    short: [
      "늘 건강하고 행복하세요.",
      "고맙고 사랑하는 마음을 전합니다.",
      "앞날에 기쁨과 평안이 가득하기를 바랍니다."
    ],
    medium: [
      "말로 다 전하지 못한 감사와 사랑을 이 글에 담아 오래도록 마음에 간직합니다.",
      "함께한 소중한 시간에 감사드리며 앞으로의 모든 날에 건강과 행복이 가득하기를 바랍니다.",
      "당신이 걸어온 빛나는 길에 존경을 보내며 새로운 시작에도 따뜻한 웃음이 함께하기를 기원합니다."
    ],
    long: [
      "오랜 시간 한결같은 사랑과 정성으로 우리 곁을 지켜주신 마음에 깊이 감사드립니다. 앞으로의 날들도 건강과 평안 속에서 환한 웃음과 행복이 늘 함께하시기를 진심으로 기원합니다.",
      "함께 걸어온 모든 순간이 소중한 추억이 되었듯 앞으로 맞이할 날들 또한 따뜻한 사랑과 기쁨으로 가득하기를 바랍니다. 말로 다 전하지 못한 존경과 감사의 마음을 이 글에 정성껏 담아 전합니다.",
      "당신이 보여주신 따뜻한 마음과 성실한 삶은 우리에게 오래도록 빛나는 가르침이 되었습니다. 새로운 길을 시작하는 오늘, 건강과 행복이 늘 곁에 머물고 뜻하시는 모든 일이 아름답게 이루어지기를 바랍니다."
    ],
    veryLong: [
      "지금까지 걸어오신 길마다 묵묵한 사랑과 정성이 깃들어 있었고, 그 따뜻한 마음은 우리 모두에게 든든한 힘과 귀한 가르침이 되었습니다. 말로는 다 표현하지 못한 깊은 감사와 존경을 이 글에 담아 전합니다. 앞으로 맞이하는 모든 날에도 건강과 평안이 늘 함께하고, 소망하시는 일마다 기쁨으로 이루어지며, 사랑하는 분들과 환한 웃음을 오래도록 나누시기를 진심으로 기원합니다.",
      "함께한 시간 속에서 베풀어주신 사랑과 배려 덕분에 우리는 수많은 어려움을 이겨내고 오늘의 행복을 누릴 수 있었습니다. 언제나 변함없이 곁을 지켜주신 고마운 마음을 오래도록 잊지 않겠습니다. 이제부터 펼쳐질 새로운 날들이 지난날보다 더욱 평안하고 아름답기를 바라며, 몸과 마음 모두 건강하시고 매일의 삶 속에 따뜻한 웃음과 뜻깊은 기쁨이 가득하시기를 진심으로 기원합니다.",
      "한결같은 성실함과 따뜻한 마음으로 걸어오신 빛나는 발자취에 깊은 존경을 보냅니다. 당신이 보여주신 삶의 모습은 곁에 있는 모든 이에게 용기와 희망이 되었으며 오래도록 기억될 소중한 가르침이 되었습니다. 새로운 시작을 맞이하는 이 순간, 지나온 날의 보람은 더욱 빛나고 앞으로의 시간은 사랑과 행복으로 풍성해지기를 바랍니다. 언제나 건강과 평안이 함께하고 뜻하시는 모든 소망이 아름답게 이루어지기를 마음 깊이 기원합니다."
    ]
  };

  return (groups[range] || groups.short).map(function (sentence) {
    return prefix + sentence;
  });
}

function makeRequestSentence() {
  const storyElement = document.getElementById("requestStory");
  const recipientElement = document.getElementById("recipient");
  const suggestionBox = document.getElementById("aiSuggestion");
  const checkbox = document.getElementById("useAiRecommendation");
  const panel = document.getElementById("aiRecommendationPanel");

  if (!storyElement || !suggestionBox) {
    showMessage("페이지 연결에 문제가 있습니다. 새 파일로 교체한 뒤 다시 실행해 주세요.", "error");
    return;
  }

  if (checkbox && !checkbox.checked) checkbox.checked = true;
  if (panel) panel.hidden = false;

  const story = storyElement.value.trim();
  const recipient = recipientElement ? recipientElement.value.trim() : "";

  if (!story) {
    showMessage("먼저 ‘전하고 싶은 마음과 사연’을 적어주세요.", "error");
    storyElement.focus();
    return;
  }

  const range = getSelectedAiLengthRange();
  const setting = getAiLengthSetting(range);
  const suggestions = buildAiSuggestions(range, recipient);
  currentAiSuggestion = "";

  suggestionBox.innerHTML = suggestions.map(function (sentence, index) {
    const count = countSentenceCharacters(sentence);
    const isInRange = count >= setting.min && count <= setting.max;
    return `
      <div class="ai-suggestion-card">
        <div class="ai-suggestion-number">${index + 1}</div>
        <div class="ai-suggestion-content">
          <p>${escapeHtml(sentence)}</p>
          <small class="${isInRange ? "range-ok" : "range-note"}">공백 제외 ${count}자 · ${setting.label} 기본비용 ${setting.price}</small>
        </div>
        <button type="button" onclick="useAiSuggestion(${index})">이 문구 사용하기</button>
      </div>
    `;
  }).join("");

  window.generatedAiSuggestions = suggestions;
  showMessage("선택한 글자 수 기준에 맞춰 참고 문구 3개를 만들었습니다.", "success");
}

function useAiSuggestion(index) {
  const chosenSentence = document.getElementById("chosenSentence");
  const suggestions = window.generatedAiSuggestions || [];
  const selected = suggestions[index];

  if (!selected) {
    showMessage("먼저 ‘AI 참고 문구 만들기’를 눌러주세요.", "error");
    return;
  }

  if (!chosenSentence) return;
  currentAiSuggestion = selected;
  chosenSentence.value = selected;
  chosenSentence.dispatchEvent(new Event("input"));
  chosenSentence.focus();
  showMessage("선택한 문구를 입력란에 넣었습니다. 원하는 표현으로 자유롭게 고쳐주세요.", "success");
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
    id: "G" + Date.now(),
    createdAt: new Date().toLocaleString("ko-KR"),
    name: getValue("customerName"),
    phone: getValue("customerPhone"),
    email: getValue("customerEmail"),
    workType: getValue("workType"),
    workShape: getValue("workShape"),
    workSize: getValue("workSize"),
    writingMood: getValue("writingMood"),
    dueDate: getValue("dueDate"),
    recipient: getValue("recipient"),
    story: getValue("requestStory"),
    sentence: getValue("chosenSentence"),
    usedAi: checkbox ? checkbox.checked : false,
    aiLengthRange: getSelectedAiLengthRange(),
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
    { id: "workType", label: "원하는 종류" },
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
        ${printInfo("원하는 종류", data.workType)}
        ${printInfo("전하는 대상", data.recipient || "미입력")}
        ${printInfo("작품 형태", data.workShape || "함께 상의")}
        ${printInfo("희망 크기", data.workSize || "함께 상의")}
        ${printInfo("글씨 분위기", data.writingMood || "함께 상의")}
        ${printInfo("희망 완료일", data.dueDate || "함께 상의")}
        ${printInfo("AI 도움 사용", data.usedAi ? "사용함" : "사용하지 않음")}
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
