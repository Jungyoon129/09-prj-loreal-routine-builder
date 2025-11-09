console.log("script.js loaded");

/* ===================== CONFIG ===================== */
// Cloudflare Worker 프록시 URL (본인 것)
const WORKER_URL = "https://wispy-butterfly-505e.jlee414.workers.dev";
// 카테고리 선택 전에 제품 숨기기 게이트
const REQUIRE_CATEGORY_FIRST = true;

/* ===================== DOM refs ===================== */
const categoryFilter    = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedList      = document.getElementById("selectedProductsList");
const chatForm          = document.getElementById("chatForm");
const chatWindow        = document.getElementById("chatWindow");
const generateBtn       = document.getElementById("generateRoutine");

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
const idOf    = (p) => String(p.id);
const hasText = (s) => typeof s === "string" && s.trim().length > 0;

/* ===================== Gate (카테고리 선택 전) ===================== */
function renderGate() {
  if (!REQUIRE_CATEGORY_FIRST) return false;

  const cat = (categoryFilter?.value || "").trim();
  const needGate = !cat; // 비어 있으면 게이트 ON

  if (needGate) {
    productsContainer.innerHTML = `
      <div class="placeholder-card" role="status" aria-live="polite">
        <div class="placeholder-head">
          <span class="filter-icon" aria-hidden="true">🔎</span>
          <strong>Select a category</strong>
        </div>
        <p>Choose a category from the dropdown to browse products.</p>
      </div>
    `;
  }
  return needGate;
}

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
      <div class="product-card ${on ? "selected" : ""}" data-id="${idOf(p)}" tabindex="0">
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
      renderSelected();
    });

    // 키보드 Space/Enter로 토글
    card.addEventListener("keydown", (e)=>{
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.click();
      }
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

      renderSelected(); // 전체 기준으로 재렌더
    });
  });
}

/* ===================== Category & Search ===================== */
// “All Categories” 프롬프트 옵션 보장
(function ensureDefaultCategoryPrompt(){
  if (!categoryFilter) return;
  const hasBlank = [...categoryFilter.options].some(o => o.value === "");
  if (!hasBlank) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "All Categories";
    opt.selected = true;
    categoryFilter.insertBefore(opt, categoryFilter.firstChild);
  } else {
    categoryFilter.value = "";
  }
})();

// 동적 검색 입력 (LevelUp: Product Search)
const searchWrap = document.createElement("div");
searchWrap.className = "search-inline";
searchWrap.innerHTML = `
  <input id="productSearch" type="search" placeholder="Search products..." aria-label="Search products"/>
`;
categoryFilter?.parentElement?.appendChild(searchWrap);
const searchInput = document.getElementById("productSearch");

function applyFilters(){
  // 게이트: 카테고리 선택 전이면 제품 숨기기
  if (renderGate()) {
    currentProductsCache = [];
    return;
  }

  const cat = (categoryFilter?.value || "").toLowerCase();
  const q   = (searchInput?.value || "").toLowerCase();

  const inCat = !cat ? allProducts : allProducts.filter(p => String(p.category).toLowerCase() === cat);
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
  renderSelected();
}

// 카테고리 변경/검색 입력
categoryFilter?.addEventListener("change", applyFilters);
let t;
searchInput?.addEventListener("input", ()=>{
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

/* ====== Chat Reset 버튼 주입 ====== */
(function addChatReset(){
  if (!chatForm) return;
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.id = "resetChat";
  resetBtn.className = "reset-btn";
  resetBtn.title = "Reset chat";
  resetBtn.textContent = "Reset";
  // 폼의 끝에 붙이기 (아이콘 버튼 옆)
  chatForm.appendChild(resetBtn);

  resetBtn.addEventListener("click", ()=>{
    chatMessages = [];
    persistMessages();
    chatWindow.innerHTML = "";
    appendMsg("assistant", "Chat has been reset.");
  });
})();

/* ===================== OpenAI via Worker ===================== */
async function callOpenAI(messages, model = "gpt-4o-mini", temperature = 0.7){
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model, temperature })
  });
  // Worker는 OpenAI 원본 JSON을 그대로 반환하도록 구성되어 있음
  if (!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Worker error: ${res.status} ${res.statusText}\n${t}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content from model.");
  return content;
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

/* ===================== Generate Routine ===================== */
generateBtn?.addEventListener("click", async ()=>{
  if (selectedIds.size === 0){
    appendMsg("assistant", "Please select at least one product first.");
    return;
  }
  appendMsg("assistant", "Building your personalized routine…");

  try{
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
chatForm?.addEventListener("submit", async (e)=>{
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
  if (!categoryFilter) return;
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
    renderSelected(); // 기존 선택 복원

    // 로드 직후 게이트 적용(카테고리 미선택이면 안내 카드)
    if (!renderGate()) {
      // 게이트가 꺼져 있으면 바로 렌더
      displayProducts(allProducts);
    }
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

  const genBtn = document.getElementById('generateRoutine');
  panel.insertBefore(btn, genBtn);

  btn.addEventListener('click', ()=>{
    if (!selectedIds.size) return;
    selectedIds.clear();
    persistSelected();

    productsContainer.querySelectorAll('.product-card.selected')
      .forEach(card => card.classList.remove('selected'));

    renderSelected();
  });
})();
