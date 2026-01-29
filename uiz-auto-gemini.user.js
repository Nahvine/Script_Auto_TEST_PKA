// ==UserScript==
// @name         Quiz Auto (Gemini) — strict + memory(text) + harvest-only + stats + export + delete (v2.0)
// @namespace    vanh-quiz-auto
// @version      2.0
// @description  Auto-answer (1 API/câu), nhớ đáp án theo TEXT, học từ review; loại trừ đáp án sai; không chọn bừa; multi-key + rotate + stats; export từ MEMORY (JSON/CSV) + export từ page; delete data an toàn
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  /* ===== Consts & Storage ===== */
  const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
  const LS_KEYS  = "quiz_gemini_keys";
  const LS_IDX   = "quiz_gemini_key_idx";
  const LS_NQ    = "quiz_auto_num_questions";
  const LS_DELAY = "quiz_auto_delay_secs";
  const LS_AUTOROTATE = "quiz_auto_rotate"; // "1" or "0"
  const SS_STATE = "quiz_auto_state_v1";

  // Memory V2 (text-based):
  // mem[qKey] = {
  //   qRaw?: string,
  //   correct?: { raw, n, na },
  //   wrong?:   Array<{ raw, n, na }>,
  //   options?: Array<{ raw, n, na }>,  // union tất cả phương án đã thấy
  //   // legacy: correctIndex?: number|null, wrong?: number[]
  // }
  const LS_MEM = "quiz_auto_memory_v1";

  const SELECTORS = {
    QUESTION_VISIBLE: "[id^='question_'][id$='_question_text'].question_text",
    QUESTION_HIDDEN:  ".original_question_text textarea[name='question_text']",
    ANSWER_BLOCKS:    ".answers .answer",
    ANSWER_LABEL:     ".answer_label, .answer_text",
    ANSWER_RADIO:     "input[type='radio'].question_input",
    NEXT_BUTTON:      "button.next-question"
  };

  /* ===== Utils ===== */
  const normWS  = s => (s || "").replace(/\s+/g, " ").trim();
  const sleep   = ms => new Promise(r => setTimeout(r, ms));
  function strHash(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=(h*16777619)>>>0; } return String(h); }
  function stripDiacritics(str){ return (str||"").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function normalizeText(s){
    const a = normWS(s).toLowerCase().replace(/[“”"':,.!?()[\]{}•*<>/\\|;~^`+=_-]+/g, " ").replace(/\s+/g, " ").trim();
    const na = stripDiacritics(a);
    return { raw: s||"", n: a, na };
  }
  function sameText(a, b){ return !!(a&&b) && (a.n===b.n || a.na===b.na); }
  function qKeyOf(s){ const t = normalizeText(s); return (t.na || t.n).slice(0, 400); }

  /* ===== Memory ===== */
  function loadMem(){ try{ return JSON.parse(localStorage.getItem(LS_MEM)||"{}"); }catch{return{};} }
  function saveMem(m){ localStorage.setItem(LS_MEM, JSON.stringify(m||{})); updateMemStats(); }
  function ensureEntry(mem, qKey){
    if(!mem[qKey]) mem[qKey] = { wrong: [], options: [] };
    if(!Array.isArray(mem[qKey].wrong))   mem[qKey].wrong   = [];
    if(!Array.isArray(mem[qKey].options)) mem[qKey].options = [];
    return mem[qKey];
  }
  function pushUnique(arr, t){
    if(!t || !t.n) return;
    if(!arr.some(x => x.n===t.n || x.na===t.na)) arr.push(t);
  }
  function setCorrectText(qKey, raw){
    const mem = loadMem();
    const e = ensureEntry(mem, qKey);
    e.correct = normalizeText(raw);
    // luôn đảm bảo correct có trong options
    pushUnique(e.options, e.correct);
    saveMem(mem);
  }
  function addWrongText(qKey, raw){
    const mem = loadMem();
    const e = ensureEntry(mem, qKey);
    const t = normalizeText(raw);
    pushUnique(e.wrong, t);
    pushUnique(e.options, t);
    saveMem(mem);
  }
  function setQuestionRaw(qKey, qRaw){
    const mem = loadMem();
    const e   = ensureEntry(mem, qKey);
    if(qRaw && (!e.qRaw || e.qRaw.length < qRaw.length)) e.qRaw = qRaw; // giữ bản text dài hơn/đầy đủ hơn
    saveMem(mem);
  }
  function mergeOptionsText(qKey, answersArray){
    if(!Array.isArray(answersArray)) return;
    const mem = loadMem(); const e = ensureEntry(mem, qKey);
    for(const raw of answersArray){
      const t = normalizeText(raw);
      pushUnique(e.options, t);
    }
    saveMem(mem);
  }

  // Migration: index -> text (nếu có options hiện tại)
  function migrateEntryWithOptions(entry, optionsMeta){
    if(!entry) return;
    if(!Array.isArray(entry.options)) entry.options=[];
    if(entry.correct && entry.correct.n) {
      // đảm bảo correct có trong options
      pushUnique(entry.options, entry.correct);
    }
    if(Number.isInteger(entry.correctIndex) && optionsMeta[entry.correctIndex] && !(entry.correct && entry.correct.n)){
      entry.correct = normalizeText(optionsMeta[entry.correctIndex].raw);
      pushUnique(entry.options, entry.correct);
    }
    if(entry.wrong && entry.wrong.length && typeof entry.wrong[0] === "number"){
      const newWrong = [];
      for(const wi of entry.wrong){
        if(Number.isInteger(wi) && optionsMeta[wi]){
          const t = normalizeText(optionsMeta[wi].raw);
          pushUnique(newWrong, t);
          pushUnique(entry.options, t);
        }
      }
      entry.wrong = newWrong;
    }
  }

  /* ===== Keys ===== */
  function getKeys(){
    let raw = localStorage.getItem(LS_KEYS);
    if(!raw){
      const defaults=[
        "AIzaSyD7VvHT5S-yntEDVL82wgOSsPmYSWuaXs8",
        "AIzaSyBQJfAFkGRsv_jhL0FP1Sf4eXVfNhoo7Ec",
        "AIzaSyC5el-uH5Ca6DUbVilo008nahv2pwn3tPw"
      ];
      raw = JSON.stringify(defaults);
      localStorage.setItem(LS_KEYS, raw);
    }
    try{
      const obj = JSON.parse(raw);
      if(Array.isArray(obj)) return obj.filter(Boolean);
      if(typeof obj==="string" && obj) return [obj];
      return [];
    }catch{ localStorage.setItem(LS_KEYS,"[]"); return []; }
  }
  function setKeys(arr){ localStorage.setItem(LS_KEYS, JSON.stringify(arr||[])); }
  function getKeyIndex(){ const v=parseInt(localStorage.getItem(LS_IDX)||"0",10); return Number.isFinite(v)&&v>=0?v:0; }
  function setKeyIndex(i){ localStorage.setItem(LS_IDX, String(i)); }
  function getCurrentKey(){
    const ks=getKeys(); if(!ks.length) return null;
    let i=getKeyIndex(); if(i<0||i>=ks.length){ i=0; setKeyIndex(0); }
    return { key: ks[i], idx: i, total: ks.length };
  }

  /* ===== Persistent State ===== */
  function loadState(){ try{ return JSON.parse(sessionStorage.getItem(SS_STATE)||"{}"); }catch{return{};} }
  function saveState(st){ sessionStorage.setItem(SS_STATE, JSON.stringify(st||{})); }
  function clearState(){ sessionStorage.removeItem(SS_STATE); }

  /* ===== DOM helpers (quiz page) ===== */
  function getQuestionText(){
    const el=document.querySelector(SELECTORS.QUESTION_VISIBLE);
    if(el && normWS(el.innerText)) return normWS(el.innerText);
    const hidden=document.querySelector(SELECTORS.QUESTION_HIDDEN);
    if(hidden && normWS(hidden.value)) return normWS(hidden.value);
    throw new Error("Không tìm thấy text câu hỏi");
  }
  function getAnswers(){
    const blocks=[...document.querySelectorAll(SELECTORS.ANSWER_BLOCKS)];
    if(!blocks.length) throw new Error("Không tìm thấy danh sách đáp án");
    const items=blocks.map((b,idx)=>{
      const label=b.querySelector(SELECTORS.ANSWER_LABEL);
      const raw=label ? (label.innerText||label.textContent||"") : "";
      return { idx, raw:normWS(raw), t:normalizeText(raw), radio:b.querySelector(SELECTORS.ANSWER_RADIO), el:b };
    }).filter(x=>x.raw && x.radio);
    if(!items.length) throw new Error("Không trích xuất được đáp án hợp lệ");
    return items;
  }
  function enableAndCheck(radio){
    radio.removeAttribute("disabled");
    radio.disabled=false; radio.checked=true;
    radio.dispatchEvent(new Event("change",{bubbles:true}));
    radio.dispatchEvent(new Event("input",{bubbles:true}));
  }
  function clickNext(){ const btn=document.querySelector(SELECTORS.NEXT_BUTTON); if(btn) btn.click(); }

  /* ===== Modal Consent ===== */
  function ensureModalRoot(){
    let root=document.getElementById("quiz-auto-modal-root");
    if(root) return root;
    root=document.createElement("div");
    root.id="quiz-auto-modal-root";
    Object.assign(root.style,{position:"fixed",inset:"0",zIndex:2147483647,pointerEvents:"none"});
    document.body.appendChild(root);
    return root;
  }
  function askConsentModal(message, confirmText="Rotate", cancelText="Cancel"){
    return new Promise((resolve)=>{
      const root=ensureModalRoot();
      const overlay=document.createElement("div");
      Object.assign(overlay.style,{position:"absolute",inset:"0",background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"auto",fontFamily:"system-ui,-apple-system,Segoe UI,Roboto,sans-serif"});
      const box=document.createElement("div");
      Object.assign(box.style,{width:"360px",background:"#111827",color:"#fff",borderRadius:"12px",boxShadow:"0 10px 25px rgba(0,0,0,.35)",padding:"16px",display:"grid",gap:"12px"});
      const msg=document.createElement("div"); msg.textContent=message;
      const row=document.createElement("div"); Object.assign(row.style,{display:"flex",gap:"8px",justifyContent:"flex-end"});
      const btnOk=document.createElement("button"); btnOk.textContent=confirmText; Object.assign(btnOk.style,{padding:"8px 12px",border:"none",borderRadius:"8px",background:"#4f46e5",color:"#fff",fontWeight:"700",cursor:"pointer"});
      const btnCancel=document.createElement("button"); btnCancel.textContent=cancelText; Object.assign(btnCancel.style,{padding:"8px 12px",border:"none",borderRadius:"8px",background:"#6b7280",color:"#fff",fontWeight:"700",cursor:"pointer"});
      btnOk.onclick=()=>{ root.removeChild(overlay); resolve(true); };
      btnCancel.onclick=()=>{ root.removeChild(overlay); resolve(false); };
      row.append(btnCancel, btnOk); box.append(msg,row); overlay.append(box); root.append(overlay);
    });
  }

  /* ===== Key rotation helper ===== */
  async function askRotateConsentAsync(reasonText){
    const keys=getKeys(); if(keys.length<=1) return null;
    const auto = localStorage.getItem(LS_AUTOROTATE)==="1";
    const cur = getKeyIndex(); const next = (cur+1)%keys.length;
    if(auto){ setKeyIndex(next); updateKeyBadge(); return getCurrentKey(); }
    const ok = await askConsentModal(`[QuizAuto] ${reasonText}\nChuyển sang API key #${next+1}/${keys.length}?`,"Rotate","Cancel");
    if(!ok) return null;
    setKeyIndex(next); updateKeyBadge(); return getCurrentKey();
  }

  /* ===== Gemini (single call) ===== */
  async function askGemini(question, options){
    const cur = getCurrentKey(); if(!cur) throw new Error("Chưa cấu hình API key.");
    const sys  = [
      "Bạn là AI chuyên giải trắc nghiệm theo giáo trình kinh tế - chính trị VN.",
      "Chỉ chọn đúng 1 phương án TRONG DANH SÁCH đã cho.",
      "Trả về JSON DUY NHẤT: {\"answerText\":\"...\",\"answerIndex\":N}. Không thêm chữ nào khác.",
      "Nếu không chắc chắn 100% với một phương án trong danh sách, vẫn phải chọn phương án KHỚP NHẤT theo nội dung câu hỏi."
    ].join(" ");
    const user = [
      `Câu hỏi: ${question}`,
      "Phương án:",
      ...options.map((o,i)=>`- [${i}] ${o}`),
      'Chỉ trả JSON như: {"answerText":"...","answerIndex":0}'
    ].join("\n");
    const body = { contents:[{role:"user",parts:[{text:sys+"\n\n"+user}]}], generationConfig:{temperature:0} };

    async function doCall(apiKey, isRetry429=false){
      const url = `${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`;
      let res, data=null;
      try{
        res = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
        try{ data = await res.json(); }catch{}
      }catch{
        const rotated = await askRotateConsentAsync("Lỗi mạng khi gọi API");
        if(rotated) return doCall(rotated.key);
        throw new Error("Lỗi mạng và không đổi key.");
      }
      if(res.status===429 && !isRetry429){ await sleep(800); return doCall(apiKey, true); }
      if([401,403,429].includes(res.status)){
        const rotated = await askRotateConsentAsync(`HTTP ${res.status} (quota/invalid/blocked)`);
        if(rotated) return doCall(rotated.key);
        throw new Error(`Gemini lỗi HTTP ${res.status} (không đổi key)`);
      }
      if(!res.ok) throw new Error(`Gemini lỗi HTTP ${res.status}`);

      const cands = data?.candidates;
      if(!Array.isArray(cands) || cands.length===0){
        const rotated = await askRotateConsentAsync("Phản hồi rỗng/blocked (no candidates)");
        if(rotated) return doCall(rotated.key);
        throw new Error("Gemini không trả về kết quả (no candidates).");
      }
      const text = cands[0]?.content?.parts?.map(p=>p.text).join("") || "{}";
      function extractJSON(text){
          const match = text.match(/\{[\s\S]*?\}/);
          if(!match) return null;
          try{ return JSON.parse(match[0]); }catch{ return null; }
      }

        const obj = extractJSON(text) || {};

      return obj;
    }

    const obj = await doCall(cur.key);
    if(Number.isInteger(obj.answerIndex) && options[obj.answerIndex]) return obj;
    if(obj.answerText){
      const normAns = normalizeText(obj.answerText);
      const idx = options.findIndex(o=> sameText(normalizeText(o), normAns));
      if(idx>=0) return {answerText:options[idx], answerIndex:idx};
    }
    throw new Error("Gemini trả JSON không hợp lệ với danh sách đáp án.");
  }

  /* ===== Core per question (with robust memory) ===== */
  async function runOnce(){
    const q = getQuestionText();
    const items = getAnswers();
    const key = qKeyOf(q);
    const mem = loadMem();
    const entry = mem[key];

    const opts = items.map(it=>({ idx: it.idx, raw: it.raw, t: it.t }));

    // enrich memory mỗi lần thấy câu
    setQuestionRaw(key, q);
    mergeOptionsText(key, opts.map(o=>o.raw));

    if(entry) migrateEntryWithOptions(entry, opts);

    // 1) nếu biết correct -> chọn theo text
    const freshMem = loadMem();
    const ent = freshMem[key];
    if (ent && ent.correct && ent.correct.n){
      const pick = opts.find(o => sameText(o.t, ent.correct));
      if(pick){ enableAndCheck(items[pick.idx].radio); return q; }
    }

    // 2) loại trừ sai
    let allowed = opts.slice();
    if (ent && Array.isArray(ent.wrong) && ent.wrong.length){
      allowed = allowed.filter(o => !ent.wrong.some(w => sameText(o.t, w)));
      if (!allowed.length) allowed = opts.slice();
    }
    if (allowed.length === 1) { enableAndCheck(items[allowed[0].idx].radio); return q; }

    // 3) AI
    const reduced = allowed.map(x=>x.raw);
    const ans = await askGemini(q, reduced);
    if(Number.isInteger(ans.answerIndex) && allowed[ans.answerIndex]){
      const real = allowed[ans.answerIndex];
      enableAndCheck(items[real.idx].radio);
      return q;
    }
    throw new Error("Không match đáp án nào hợp lệ.");
  }

  /* ===== Robust review-page parsing / Harvest / Export (PAGE) ===== */
  function getAllQuestionBlocksOnReviewPage(){
    const sels = [
      ".display_question.question.multiple_choice_question",
      ".display_question.multiple_choice_question",
      ".question.multiple_choice_question",
      ".quiz_sortable .display_question.question",
    ];
    const set = new Set();
    const out = [];
    for(const s of sels){
      document.querySelectorAll(s).forEach(n=>{
        if(!set.has(n)) { set.add(n); out.push(n); }
      });
    }
    return out;
  }
  function findChosenIndex(block, answerBlocks){
    const sel = block.querySelector(".answer.selected_answer") || block.querySelector(".selected_answer");
    if(sel){ const idx=answerBlocks.indexOf(sel.closest(".answer")||sel); if(idx>=0) return idx; }
    for(let i=0;i<answerBlocks.length;i++){
      const r = answerBlocks[i].querySelector("input[type='radio'].question_input");
      if(r && (r.checked || r.hasAttribute("checked"))) return i;
    }
    for(let i=0;i<answerBlocks.length;i++){
      const t = answerBlocks[i].getAttribute("title") || "";
      if(/You selected this answer/i.test(t)) return i;
    }
    for(let i=0;i<answerBlocks.length;i++){
      const r = answerBlocks[i].querySelector("input[type='radio']");
      if(r && (r.getAttribute("aria-checked")==="true")) return i;
    }
    return -1;
  }
  function parseQuestionBlock(block){
    const isIncorrect =
      block.classList.contains("incorrect") ||
      !!block.querySelector(".answer_arrow.incorrect");

    let qText = "";
    const q1 = block.querySelector("[id^='question_'][id$='_question_text'].question_text");
    const q2 = block.querySelector(".original_question_text textarea[name='question_text']");
    if (q1 && q1.innerText) qText = q1.innerText;
    else if (q2 && q2.value) qText = q2.value;
    else {
      const h = block.querySelector(".question_text, .text, h3, h4, .name.question_name");
      if (h) qText = h.innerText || h.textContent || "";
    }
    qText = normWS(qText);
    if (!qText) return { error: "no_question_text" };

    const answerBlocks = Array.from(block.querySelectorAll(".answers .answer"));
    if (!answerBlocks.length) return { error: "no_answers", qText };

    const chosenIdx = findChosenIndex(block, answerBlocks);
    if (chosenIdx < 0) return { error: "no_chosen", qText };

    const texts = answerBlocks.map(a => {
      const t = a.querySelector(SELECTORS.ANSWER_LABEL);
      return normWS(t && (t.innerText || t.textContent) || "");
    });

    return {
      qText,
      qKey: qKeyOf(qText),
      isIncorrect,
      chosenIdx,
      chosenText: texts[chosenIdx] || "",
      answers: texts
    };
  }
  function harvestQA(){
    const blocks = getAllQuestionBlocksOnReviewPage();
    if (!blocks.length) { alert("Không tìm thấy block câu hỏi để thu thập."); return; }

    const seen = new Set();
    let learnedCorrect = 0, learnedWrong = 0, skipped = 0;
    let errNoQ=0, errNoAns=0, errNoChosen=0;

    for (const b of blocks){
      const info = parseQuestionBlock(b);
      if (!info) { skipped++; continue; }
      if (info.error){
        if(info.error==="no_question_text") errNoQ++;
        else if(info.error==="no_answers") errNoAns++;
        else if(info.error==="no_chosen") errNoChosen++;
        skipped++;
        continue;
      }
      if (seen.has(info.qKey)) { skipped++; continue; }
      seen.add(info.qKey);

      // enrich memory: qRaw + options
      setQuestionRaw(info.qKey, info.qText);
      mergeOptionsText(info.qKey, info.answers);

      if (info.isIncorrect) {
        const before = (loadMem()[info.qKey]?.wrong?.length)||0;
        addWrongText(info.qKey, info.chosenText);
        const after  = (loadMem()[info.qKey]?.wrong?.length)||0;
        if (after>before) learnedWrong++; else skipped++;
      } else {
        const beforeHad = !!(loadMem()[info.qKey]?.correct?.n);
        setCorrectText(info.qKey, info.chosenText);
        const afterHad  = !!(loadMem()[info.qKey]?.correct?.n);
        if (!beforeHad && afterHad) learnedCorrect++; else skipped++;
      }
    }

    updateMemStats();
    alert(`Harvest xong:
- Learned correct: ${learnedCorrect}
- Learned wrong:   ${learnedWrong}
- Skipped:         ${skipped}
  └─ NoQuestionText: ${errNoQ}, NoAnswers: ${errNoAns}, NoChosen: ${errNoChosen}`);
  }

  // EXPORT từ PAGE (giữ lại tính năng cũ)
  function exportCorrectQAFromPage(){
    const blocks = getAllQuestionBlocksOnReviewPage();
    if (!blocks.length) { alert("Không tìm thấy block câu hỏi để export (page)."); return; }

    const dataset = [];
    const seen = new Set();
    let errNoQ=0, errNoAns=0, errNoChosen=0, filteredIncorrect=0, dedup=0;

    for(const b of blocks){
      const info = parseQuestionBlock(b);
      if(!info){ continue; }
      if(info.error){
        if(info.error==="no_question_text") errNoQ++;
        else if(info.error==="no_answers") errNoAns++;
        else if(info.error==="no_chosen") errNoChosen++;
        continue;
      }
      if(info.isIncorrect){ filteredIncorrect++; continue; }
      if(seen.has(info.qKey)){ dedup++; continue; }
      seen.add(info.qKey);

      dataset.push({
        question: info.qText,
        answers: info.answers,
        correctIndex: info.chosenIdx,
        correctText: info.chosenText
      });
    }

    if(!dataset.length){
      alert(`Không có câu đúng nào để export (page).
Skipped -> NoQ:${errNoQ}, NoAns:${errNoAns}, NoChosen:${errNoChosen}, IncorrectFiltered:${filteredIncorrect}`);
      return;
    }

    const type = (prompt("Export format? (json/csv)", "json") || "json").toLowerCase();
    if(type==="csv"){
      const csv = toCSV(dataset);
      downloadFile(csv, "quiz_correct_page.csv", "text/csv;charset=utf-8");
    }else{
      const json = JSON.stringify(dataset, null, 2);
      downloadFile(json, "quiz_correct_page.json", "application/json;charset=utf-8");
    }
    alert(`Exported (page): ${dataset.length}.
Dedup:${dedup}, IncorrectFiltered:${filteredIncorrect}, NoQ:${errNoQ}, NoAns:${errNoAns}, NoChosen:${errNoChosen}`);
  }

  /* ===== EXPORT từ MEMORY (mới) ===== */
  function exportMemoryQA(){
    const mem = loadMem();
    // chỉ xuất những câu có đáp án đúng đã biết
    const entries = [];
    for(const k in mem){
      const e = mem[k];
      if(!e || !(e.correct && e.correct.n)) continue;
      const question = e.qRaw || k; // ưu tiên qRaw
      // dựng danh sách answers: ưu tiên options nếu có
      let answersRaw = [];
      if(Array.isArray(e.options) && e.options.length){
        // unique theo normalized và cố gắng đưa correct vào đúng vị trí
        const uniq = [];
        const seenN = new Set();
        for(const opt of e.options){
          if(!opt || !opt.n || seenN.has(opt.n)) continue;
          seenN.add(opt.n); uniq.push(opt);
        }
        // đảm bảo correct có mặt
        if(!uniq.some(o=>sameText(o, e.correct))) uniq.unshift(e.correct);
        answersRaw = uniq.map(o=>o.raw);
      }else{
        // fallback: correct + wrong
        const wrongs = Array.isArray(e.wrong) ? e.wrong : [];
        const uniq = [];
        const seen = new Set();
        // correct trước
        uniq.push(e.correct);
        seen.add(e.correct.n);
        for(const w of wrongs){
          if(w && w.n && !seen.has(w.n)){ seen.add(w.n); uniq.push(w); }
        }
        answersRaw = uniq.map(o=>o.raw);
      }

      // xác định correctIndex trong answersRaw
      let correctIndex = answersRaw.findIndex(r => sameText(normalizeText(r), e.correct));
      if(correctIndex < 0){
        // đặt correct ở đầu nếu không tìm được
        answersRaw = [e.correct.raw, ...answersRaw.filter(r=>!sameText(normalizeText(r), e.correct))];
        correctIndex = 0;
      }

      entries.push({
        question,
        answers: answersRaw,
        correctIndex,
        correctText: e.correct.raw
      });
    }

    if(!entries.length){
      alert("Memory chưa có câu nào được gắn đáp án đúng để export.");
      return;
    }

    const type = (prompt("Export MEMORY format? (json/csv)", "json") || "json").toLowerCase();
    if(type==="csv"){
      const csv = toCSV(entries);
      downloadFile(csv, "quiz_memory_export.csv", "text/csv;charset=utf-8");
    }else{
      const json = JSON.stringify(entries, null, 2);
      downloadFile(json, "quiz_memory_export.json", "application/json;charset=utf-8");
    }
    alert(`Exported from MEMORY: ${entries.length} items.`);
  }

  /* ===== CSV helpers ===== */
  function toCSV(items){
    const maxAns = Math.max(...items.map(it=>it.answers.length));
    const headers = ["question", ...Array.from({length:maxAns},(_,i)=>`answer_${i+1}`), "correct_index"];
    const lines = [headers.join(",")];
    for(const it of items){
      const row=[csvEscape(it.question)];
      for(let i=0;i<maxAns;i++){ row.push(csvEscape(it.answers[i]??"")); }
      row.push(String(it.correctIndex));
      lines.push(row.join(","));
    }
    return lines.join("\n");
  }
  function csvEscape(s){
    const t=(s??"").replace(/\r?\n/g," ").replace(/\s+/g," ").trim();
    if(/[",]/.test(t)) return `"${t.replace(/"/g,'""')}"`;
    return t;
  }
  function downloadFile(content, filename, mime){
    const blob=new Blob([content],{type:mime});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* ===== Memory stats (panel) ===== */
  function memStats(){
    const mem = loadMem();
    let total=0, correctQ=0, wrongQ=0, wrongChoices=0, withOptions=0;
    for(const k in mem){
      total++;
      if(mem[k]?.correct?.n) correctQ++;
      if(Array.isArray(mem[k]?.wrong) && mem[k].wrong.length){ wrongQ++; wrongChoices+=mem[k].wrong.length; }
      if(Array.isArray(mem[k]?.options) && mem[k].options.length) withOptions++;
    }
    return { total, correctQ, wrongQ, wrongChoices, withOptions };
  }
  function updateMemStats(){
    const el=document.getElementById("quiz-auto-memstats"); if(!el) return;
    const { total, correctQ, wrongQ, wrongChoices, withOptions } = memStats();
    el.textContent = `📊 Memory: ${total} Q (correct: ${correctQ}, wrong Q: ${wrongQ}, wrong choices: ${wrongChoices}, with options: ${withOptions})`;
  }

  /* ===== Resume across reloads ===== */
  async function resumeIfNeeded(){
    const st=loadState(); if(!st.running) return;
    try{ const q=getQuestionText(); if(st.lastQHash && st.lastQHash===strHash(q)) return; }catch{}
    try{
      const qtext=await runOnce();
      const newHash=strHash(qtext);
      const remain=Math.max(0,(st.remaining||0)-1);
      if(remain<=0){ clearState(); setStatus("Done"); return; }
      saveState({ running:true, remaining:remain, delay:st.delay, lastQHash:newHash });
      await sleep((st.delay||0)*1000);
      clickNext();
    }catch(e){ console.error("[QuizAuto] resume error:", e); clearState(); alert("Dừng auto: "+e.message); }
  }

  /* ===== UI ===== */
  function mountWhenBodyReady(cb){
    if(document.body){ cb(); return; }
    const iv=setInterval(()=>{ if(document.body){ clearInterval(iv); cb(); } },50);
  }

  function addUI(){
    if(document.getElementById("quiz-auto-panel")) return;
    const panel=document.createElement("div");
    panel.id="quiz-auto-panel";
    Object.assign(panel.style,{
      position:"fixed", right:"16px", bottom:"16px", zIndex:2147483647,
      background:"rgba(17,24,39,.92)", color:"#fff", padding:"12px",
      borderRadius:"12px", width:"340px", fontFamily:"system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      boxShadow:"0 2px 8px rgba(0,0,0,.25)", display:"flex", flexDirection:"column", gap:"8px"
    });

    const badge=document.createElement("div"); badge.id="quiz-auto-key-badge"; badge.style.fontSize="12px"; badge.style.opacity="0.85";
    const memstats=document.createElement("div"); memstats.id="quiz-auto-memstats"; memstats.style.fontSize="12px"; memstats.style.opacity="0.9";

    const row1=document.createElement("div"); Object.assign(row1.style,{display:"grid",gridTemplateColumns:"auto 1fr auto 1fr",gap:"8px",alignItems:"center"});
    const labN=document.createElement("div"); labN.textContent="#Q";
    const inN=document.createElement("input"); inN.type="number"; inN.min="1"; inN.step="1"; inN.value=localStorage.getItem(LS_NQ) ?? "1";
    Object.assign(inN.style,{width:"80px",padding:"6px",borderRadius:"8px",border:"1px solid #374151",background:"#111827",color:"#fff"});
    const labD=document.createElement("div"); labD.textContent="Delay(s)";
    const inD=document.createElement("input"); inD.type="number"; inD.min="0"; inD.step="0.5"; inD.value=localStorage.getItem(LS_DELAY) ?? "1";
    Object.assign(inD.style,{width:"80px",padding:"6px",borderRadius:"8px",border:"1px solid #374151",background:"#111827",color:"#fff"});
    row1.append(labN,inN,labD,inD);

    const rowAuto=document.createElement("label"); rowAuto.style.display="flex"; rowAuto.style.gap="8px"; rowAuto.style.alignItems="center";
    const chkAuto=document.createElement("input"); chkAuto.type="checkbox"; chkAuto.checked=(localStorage.getItem(LS_AUTOROTATE)==="1");
    const txtAuto=document.createElement("span"); txtAuto.textContent="Auto-rotate keys on quota";
    rowAuto.append(chkAuto, txtAuto);

    const row2=document.createElement("div"); row2.style.display="grid"; row2.style.gridTemplateColumns="1fr 1fr"; row2.style.gap="8px";
    const btnStart=document.createElement("button"); btnStart.textContent="🤖 Start";
    Object.assign(btnStart.style,{padding:"8px",border:"none",borderRadius:"8px",background:"#4f46e5",color:"#fff",fontWeight:"700",cursor:"pointer"});
    const btnStop=document.createElement("button"); btnStop.textContent="⏹ Stop";
    Object.assign(btnStop.style,{padding:"8px",border:"none",borderRadius:"8px",background:"#ef4444",color:"#fff",fontWeight:"700",cursor:"pointer"});

    const btnHarvest=document.createElement("button"); btnHarvest.textContent="📥 Harvest Q/A (review page)";
    Object.assign(btnHarvest.style,{padding:"8px",border:"none",borderRadius:"8px",background:"#2563eb",color:"#fff",fontWeight:"700",cursor:"pointer",width:"100%"});

    const btnExportPage=document.createElement("button"); btnExportPage.textContent="⬇️ Export CORRECT (page)";
    Object.assign(btnExportPage.style,{padding:"8px",border:"none",borderRadius:"8px",background:"#10b981",color:"#0b1b13",fontWeight:"800",cursor:"pointer",width:"100%"});

    const btnExportMem=document.createElement("button"); btnExportMem.textContent="⬇️ Export MEMORY (JSON/CSV)";
    Object.assign(btnExportMem.style,{padding:"8px",border:"none",borderRadius:"8px",background:"#22c55e",color:"#0b1b13",fontWeight:"800",cursor:"pointer",width:"100%"});

    const btnDelete=document.createElement("button"); btnDelete.textContent="🗑 Delete data (memory)";
    Object.assign(btnDelete.style,{padding:"8px",border:"none",borderRadius:"8px",background:"#9ca3af",color:"#111827",fontWeight:"800",cursor:"pointer",width:"100%"});

    const btnKeys=document.createElement("button"); btnKeys.textContent="⚙️ Keys";
    Object.assign(btnKeys.style,{padding:"6px 8px",border:"none",borderRadius:"8px",background:"#0f766e",color:"#fff",fontWeight:"700",cursor:"pointer",width:"100%"});

    const status=document.createElement("div"); status.id="quiz-auto-status"; status.textContent="Idle"; status.style.fontSize="12px"; status.style.opacity="0.85";

    btnStart.onclick = ()=>{ const n=Math.max(1, parseInt(inN.value||"1",10)); const d=Math.max(0, parseFloat(inD.value||"0"));
      localStorage.setItem(LS_NQ,String(n)); localStorage.setItem(LS_DELAY,String(d)); localStorage.setItem(LS_AUTOROTATE, chkAuto.checked?"1":"0");
      saveState({ running:true, remaining:n, delay:d, lastQHash:null }); setStatus(`Running: ${n} q, ${d}s`); resumeIfNeeded(); };
    btnStop.onclick = ()=>{ clearState(); setStatus("Stopped"); };
    btnKeys.onclick = ()=>{
      const keys=getKeys(); const cur=getCurrentKey();
      const msg = ["API keys (mỗi dòng 1 key).", cur?`[*] đang dùng key #${cur.idx+1}/${cur.total}`:"[!] chưa có key", "", ...keys.map((k,i)=>`${(cur && i===cur.idx)?"[*]":"   "} ${k}`), "", "Nhập lại toàn bộ keys (để trống = giữ nguyên)."].join("\n");
      const input=prompt(msg, keys.join("\n")); if(input===null) return;
      if(input.trim()){ const arr=input.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); if(arr.length){ setKeys(arr); setKeyIndex(0); updateKeyBadge(); alert(`Đã lưu ${arr.length} key. Đang dùng key #1/${arr.length}.`);} }
    };
    btnHarvest.onclick     = harvestQA;
    btnExportPage.onclick  = exportCorrectQAFromPage;  // export theo DOM trang review
    btnExportMem.onclick   = exportMemoryQA;           // export theo dữ liệu đã lưu
    btnDelete.onclick      = ()=>{ if(!confirm("Are you sure you want to DELETE all stored memory (answers)?")) return; localStorage.removeItem(LS_MEM); updateMemStats(); alert("Đã xoá toàn bộ dữ liệu bộ nhớ (answers)."); };
    chkAuto.onchange       = ()=> localStorage.setItem(LS_AUTOROTATE, chkAuto.checked ? "1" : "0");

    row2.append(btnStart, btnStop);
    panel.append(badge, memstats, row1, rowAuto, row2, btnHarvest, btnExportPage, btnExportMem, btnDelete, btnKeys, status);

    mountWhenBodyReady(()=>{ document.body.appendChild(panel); updateKeyBadge(); updateMemStats(); });
  }

  function setStatus(s){ const lab=document.getElementById("quiz-auto-status"); if(lab) lab.textContent=s; }
  function updateKeyBadge(){ const b=document.getElementById("quiz-auto-key-badge"); const cur=getCurrentKey(); if(b) b.textContent = cur ? `Key: #${cur.idx+1}/${cur.total}` : "Key: (none)"; }

  (function bootstrapUI(){ if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", addUI, {once:true}); } else { addUI(); } })();
  (function autoResume(){
    setTimeout(()=>{
      const st=loadState(); if(!st.running) return;
      const start=Date.now();
      const iv=setInterval(()=>{
        try{ getQuestionText(); getAnswers(); clearInterval(iv); setStatus(`Running: ${st.remaining} left, ${st.delay||0}s`); updateKeyBadge(); updateMemStats(); resumeIfNeeded(); }
        catch{ if(Date.now()-start>15000){ clearInterval(iv); setStatus("Idle"); } }
      },120);
    },800);
  })();
})();
