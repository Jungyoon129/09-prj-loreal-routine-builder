console.log("script.js loaded");

/* ===================== DOM refs ===================== */
const categoryFilter   = document.getElementById("categoryFilter");
const productsContainer= document.getElementById("productsContainer");
const selectedList     = document.getElementById("selectedProductsList");
const chatForm         = document.getElementById("chatForm");
const chatWindow       = document.getElementById("chatWindow");
const generateBtn      = document.getElementById("generateRoutine");

/* ===================== State & Storage ===================== */
const SELECT_KEY = "lr_selected_ids";
const MSG_KEY    = "lr_messages";
const RTL_KEY    = "lr_rtl";

const selectedIds = new Set(JSON.parse(localStorage.getItem(SELECT_KEY) || "[]"));
let   allProducts = [];           // 전체 products.json 캐시
let   currentProductsCache = [];  // 현재 카테고리로 필터된 목록
let   chatMessages = JSON.parse(localStorage.getItem(MSG_KEY) || "[]"); // [{role,content}]

function persistSelected(){ localStorage.setItem(SELECT_KEY, JSON.stringify([...selectedIds])); }
function persistMessages(){ localStorage.setItem(MSG_KEY, JSON.stringify(chatMessages)); }

/* ===================== Helpers ===================== */
const idOf = (p) => String(p.id);
const hasText = (s) => typeof s === "string" && s.trim().length > 0;

/* ===================== First Placeholder ===================== */
productsContainer.innerHTML = `<div class="placeholder-message">Select a category to view products</div>`;
selectedList.innerHTML      = selectedIds.size ? "" : `<em>No products selected.</em>`;

/* ===================== Load products.json ===================== */
async function loadProducts(){
  const res  = await fetch("products.json");
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data.products || []);
  // id 안전: 문자열로 정규화
  return list.map(p => ({...p, id: idOf(p)}));
}

/* ===================== Render: Product Cards ===================== */
function displayProducts(products){
  productsContainer.innerHTML = products.map(p=>{
    const on = selectedIds.has(idOf(p));
    return `
      <div class="product-card ${on ? "selected" : ""}" data-id="${idOf(p)}">
        <img src="${p.image}" alt="${p.name}">
        <div class="product-info">
          <h3>${p.name}</h3>
          <p>${p.brand}</p>
          <button class="details" type="button" aria-expanded="false" aria-controls="desc-${idOf(p)}">Details</button>
          <div id="desc-${idOf(p)}" class="desc" hidden>
            <p>${hasText(p.description) ? p.description : "No description available."}</p>
            ${Array.isArray(p.tags) && p.tags.length ? `<p><small>Tags: ${p.tags.join(", ")}</small></p>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Attach handlers
  productsContainer.querySelectorAll(".product-card").forEach(card=>{
    const id = card.dataset.id;

    // 카드 클릭 → 선택/해제 (Details 버튼 클릭은 제외)
    card.addEventListener("click", (e)=>{
      if (e.target.classList.contains("details")) return;
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      persistSelected();
      card.classList.toggle("selected");
      renderSelected(currentProductsCache);
    });

    // Details 토글
    const btn  = card.querySelector(".details");
    const desc = card.querySelector(".desc");
    btn.addEventListener("click", ()=>{
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      desc.hidden = expanded;
    });
  });
}

/* ===================== Render: Selected List ===================== */
function renderSelected() {
  const chosen = allProducts.filter(p => selectedIds.has(String(p.id)));

  selectedList.innerHTML = chosen.length
    ? chosen.map(p => `
        <span class="pill" data-id="${String(p.id)}">
          ${p.brand} — ${p.name}
          <button class="remove" type="button" aria-label="Remove ${p.name}">×</button>
        </span>
      `).join("")
    : `<em>No products selected.</em>`;

  // 개별 제거
  selectedList.querySelectorAll(".pill .remove").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const id = e.currentTarget.parentElement.dataset.id;
      selectedIds.delete(id);
      persistSelected();

      // 만약 현재 그 카드가 화면에 있다면 선택 표시도 제거
      const card = productsContainer.querySelector(`.product-card[data-id="${id}"]`);
      if (card) card.classList.remove("selected");

      renderSelected(); // 항상 전체 기준으로 재렌더
    });
  });
}


/* ===================== Category & Search ===================== */
// 동적으로 검색 입력 추가 (LevelUp: Product Search)
const searchWrap = document.createElement("div");
searchWrap.className = "search-inline";
searchWrap.innerHTML = `
  <input id="productSearch" type="search" placeholder="Search by name, brand, tag…" aria-label="Search products"/>
`;
categoryFilter.parentElement.appendChild(searchWrap);
const searchInput = document.getElementById("productSearch");

function applyFilters(){
  const cat = categoryFilter.value;
  const q   = (searchInput.value || "").toLowerCase();

  const inCat = !cat ? allProducts : allProducts.filter(p => String(p.category).toLowerCase() === cat.toLowerCase());
  currentProductsCache = inCat.filter(p=>{
    if (!q) return true;
    const hay = [
      p.name, p.brand, p.category,
      Array.isArray(p.tags) ? p.tags.join(" ") : "",
      p.description || ""
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });

  displayProducts(currentProductsCache);
  renderSelected(currentProductsCache);
}

// 카테고리 변경
categoryFilter.addEventListener("change", applyFilters);
// 검색 입력 (간단 디바운스)
let t;
searchInput.addEventListener("input", ()=>{
  clearTimeout(t);
  t = setTimeout(applyFilters, 150);
});

/* ===================== Chat UI ===================== */
function appendMsg(role, text){
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  if (role === "assistant" || role === "user"){
    chatMessages.push({ role, content: text });
    persistMessages();
  }
}
// 기존 히스토리 복원
if (chatMessages.length){
  chatMessages.forEach(m => appendMsg(m.role, m.content));
}

/* ===================== OpenAI (browser) ===================== */
// ⚠️ 브라우저 호출은 키가 노출됨(학습/과제용). 실제 배포는 Worker 사용 권장.
const OPENAI_KEY = (window && window.OPENAI_API_KEY) || "";
if (!OPENAI_KEY){
  console.warn("OPENAI_API_KEY 없음. secrets.js를 추가하거나 Worker로 우회하세요.");
}

function buildMessages(selectedProducts, followupText){
  const list = selectedProducts.map(p=>{
    const parts = [p.brand, p.name, `[${p.category}]`, p.description || ""].filter(Boolean);
    return parts.join(" — ");
  }).join("\n");

  const system =
    "You are a L’Oréal product-aware beauty advisor. Build AM/PM routines using ONLY the provided products. " +
    "Flag conflicts between actives (retinoids, AHAs/BHAs, benzoyl peroxide, vitamin C), suggest spacing, and always recommend patch-testing. " +
    "Keep it concise, friendly, and non-medical. Refuse unrelated topics.";

  const context =
    "Selected products:\n" + (list || "(none)") + "\n" +
    "Answer ONLY about skincare/haircare/makeup/fragrance & follow-ups related to this routine.";

  const base = [
    { role: "system", content: system },
    { role: "system", content: context },
    ...chatMessages
  ];

  const userMsg = followupText
    ? { role: "user", content: followupText }
    : { role: "user", content: "Create a safe, stepwise AM/PM routine using ONLY the selected products." };

  return [...base, userMsg];
}

async function callOpenAI(messages){
  const url  = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: "gpt-4o-mini", // 계정 가용 모델명으로 변경 가능
    messages,
    temperature: 0.7
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`OpenAI error: ${res.status} ${res.statusText}\n${t}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "(no content)";
}

/* ===================== Generate Routine ===================== */
generateBtn.addEventListener("click", async ()=>{
  if (selectedIds.size === 0){
    appendMsg("assistant", "Please select at least one product first.");
    return;
  }
  appendMsg("assistant", "Building your personalized routine…");

  try{
    // 전체 제품에서 선택된 것들 찾기 (카테고리 상관없이)
    const selected = allProducts.filter(p => selectedIds.has(idOf(p)));
    const messages = buildMessages(selected, "");
    const reply    = await callOpenAI(messages);
    appendMsg("assistant", reply);
  }catch(err){
    console.error(err);
    appendMsg("assistant", "Sorry, I couldn't generate the routine right now.");
  }
});

/* ===================== Follow-up Chat ===================== */
chatForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const input = document.getElementById("userInput");
  const text  = input.value.trim();
  if (!text) return;
  input.value = "";
  appendMsg("user", text);

  try{
    const selected = allProducts.filter(p => selectedIds.has(idOf(p)));
    const messages = buildMessages(selected, text);
    const reply    = await callOpenAI(messages);
    appendMsg("assistant", reply);
  }catch(err){
    console.error(err);
    appendMsg("assistant", "Hmm, something went wrong answering that.");
  }
});

/* ===================== RTL toggle (LevelUp) ===================== */
(function injectRTL(){
  const wrap = document.createElement("label");
  wrap.style.display = "inline-flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "6px";
  wrap.style.margin = "8px 0 0";
  wrap.innerHTML = `<input type="checkbox" id="rtlToggle"> RTL`;
  // 카테고리 select 옆에 붙이기
  categoryFilter.parentElement.appendChild(wrap);

  const rtlToggle = document.getElementById("rtlToggle");
  const on = localStorage.getItem(RTL_KEY) === "true";
  rtlToggle.checked = on;
  document.documentElement.setAttribute("dir", on ? "rtl" : "ltr");

  rtlToggle.addEventListener("change", (e)=>{
    const val = e.target.checked;
    document.documentElement.setAttribute("dir", val ? "rtl" : "ltr");
    localStorage.setItem(RTL_KEY, val ? "true" : "false");
  });
})();

/* ===================== Init ===================== */
(async function init(){
  try{
    allProducts = await loadProducts();
    // 이미 선택되어있던 항목이 있으면 Selected 영역 동기화
    renderSelected(allProducts);
    // 사용자에게 카테고리 하나 선택하도록 유도 (필수 아님)
    // categoryFilter.value = ""; // 유지
  }catch(err){
    console.error(err);
    productsContainer.innerHTML = `<p>Could not load products.</p>`;
  }
})();
/* ===================== Clear All (선택 전체 제거) ===================== */
(function addClearAll(){
  const panel = document.querySelector('.selected-products');
  if (!panel) return;

  const btn = document.createElement('button');
  btn.id = 'clearAll';
  btn.className = 'generate-btn alt';
  btn.type = 'button';
  btn.textContent = 'Clear All';

  // Generate Routine 버튼 바로 위에 추가
  const genBtn = document.getElementById('generateRoutine');
  panel.insertBefore(btn, genBtn);

  btn.addEventListener('click', ()=>{
    if (!selectedIds.size) return;

    // 선택 초기화
    selectedIds.clear();
    persistSelected();

    // UI 반영
    productsContainer.querySelectorAll('.product-card.selected')
      .forEach(card => card.classList.remove('selected'));

    renderSelected(); // 전체 기준으로 재렌더
  });
})();
