// ==UserScript==
// @name         Quiz Auto (Gemini) — strict + modal key rotation (v1.3)
// @namespace    vanh-quiz-auto
// @version      1.3
// @description  Auto-answer (1 API/câu), stop if uncertain, rotate keys via in-page modal or auto-rotate
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  /* ===== Consts & Storage ===== */
  const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  const LS_KEYS  = "quiz_gemini_keys";
  const LS_IDX   = "quiz_gemini_key_idx";
  const LS_NQ    = "quiz_auto_num_questions";
  const LS_DELAY = "quiz_auto_delay_secs";
  const LS_AUTOROTATE = "quiz_auto_rotate"; // "1" or "0"
  const SS_STATE = "quiz_auto_state_v1";

  const SELECTORS = {
    QUESTION_VISIBLE: "[id^='question_'][id$='_question_text'].question_text",
    QUESTION_HIDDEN:  ".original_question_text textarea[name='question_text']",
    ANSWER_BLOCKS:    ".answers .answer",
    ANSWER_LABEL:     ".answer_label",
    ANSWER_RADIO:     "input[type='radio'].question_input",
    NEXT_BUTTON:      "button.next-question"
  };

  const norm  = s => (s || "").replace(/\s+/g, " ").trim();
  const lc    = s => norm(s).toLowerCase();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function strHash(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=(h*16777619)>>>0; } return String(h); }

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

  /* ===== DOM helpers ===== */
  function getQuestionText(){
    const el=document.querySelector(SELECTORS.QUESTION_VISIBLE);
    if(el && norm(el.innerText)) return norm(el.innerText);
    const hidden=document.querySelector(SELECTORS.QUESTION_HIDDEN);
    if(hidden && norm(hidden.value)) return norm(hidden.value);
    throw new Error("Không tìm thấy text câu hỏi");
  }
  function getAnswers(){
    const blocks=[...document.querySelectorAll(SELECTORS.ANSWER_BLOCKS)];
    if(!blocks.length) throw new Error("Không tìm thấy danh sách đáp án");
    const items=blocks.map((b,idx)=>({
      idx,
      text:  norm(b.querySelector(SELECTORS.ANSWER_LABEL)?.innerText||""),
      radio: b.querySelector(SELECTORS.ANSWER_RADIO),
      el:    b
    })).filter(x=>x.text && x.radio);
    if(!items.length) throw new Error("Không trích xuất được đáp án hợp lệ");
    return items;
  }
  function enableAndCheck(radio){
    radio.removeAttribute("disabled");
    radio.disabled=false;
    radio.checked=true;
    radio.dispatchEvent(new Event("change",{bubbles:true}));
    radio.dispatchEvent(new Event("input",{bubbles:true}));
  }
  function clickNext(){ const btn=document.querySelector(SELECTORS.NEXT_BUTTON); if(btn) btn.click(); }

  /* ===== Modal Consent (in-page) ===== */
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
      const msg=document.createElement("div");
      msg.textContent=message;

      const row=document.createElement("div");
      Object.assign(row.style,{display:"flex",gap:"8px",justifyContent:"flex-end"});
      const btnOk=document.createElement("button");
      btnOk.textContent=confirmText; Object.assign(btnOk.style,{padding:"8px 12px",border:"none",borderRadius:"8px",background:"#4f46e5",color:"#fff",fontWeight:"700",cursor:"pointer"});
      const btnCancel=document.createElement("button");
      btnCancel.textContent=cancelText; Object.assign(btnCancel.style,{padding:"8px 12px",border:"none",borderRadius:"8px",background:"#6b7280",color:"#fff",fontWeight:"700",cursor:"pointer"});

      btnOk.onclick=()=>{ root.removeChild(overlay); resolve(true); };
      btnCancel.onclick=()=>{ root.removeChild(overlay); resolve(false); };

      row.append(btnCancel, btnOk);
      box.append(msg,row);
      overlay.append(box);
      root.append(overlay);
    });
  }

  /* ===== Key rotation helper ===== */
  async function askRotateConsentAsync(reasonText){
    const keys=getKeys(); if(keys.length<=1) return null;
    const auto = localStorage.getItem(LS_AUTOROTATE)==="1";
    const cur = getKeyIndex();
    const next = (cur+1)%keys.length;
    if(auto){
      setKeyIndex(next);
      updateKeyBadge();
      return getCurrentKey();
    }
    const ok = await askConsentModal(`[QuizAuto] ${reasonText}\nChuyển sang API key #${next+1}/${keys.length}?`,"Rotate","Cancel");
    if(!ok) return null;
    setKeyIndex(next);
    updateKeyBadge();
    return getCurrentKey();
  }

  /* ===== Gemini (single call) ===== */
  async function askGemini(question, options){
    let cur = getCurrentKey();
    if(!cur) throw new Error("Chưa cấu hình API key.");

    const sys  = "Bạn là AI chuyên trả lời trắc nghiệm theo giáo trình kinh tế chính trị VN. Trả về JSON duy nhất: {\"answerText\":\"...\",\"answerIndex\":N}. Không thêm gì khác.";
    const user = [`Câu hỏi: ${question}`,"Đáp án:",...options.map((o,i)=>`- [${i}] ${o}`)].join("\n");
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

      // 429: backoff 1 lần rồi thử lại chính key để tránh xoay quá sớm
      if(res.status===429 && !isRetry429){
        await sleep(800);
        return doCall(apiKey, true);
      }

      if([401,403,429].includes(res.status)){
        const rotated = await askRotateConsentAsync(`HTTP ${res.status} (quota/invalid/blocked)`);
        if(rotated) return doCall(rotated.key);
        throw new Error(`Gemini lỗi HTTP ${res.status} (không đổi key)`);
      }
      if(!res.ok){
        throw new Error(`Gemini lỗi HTTP ${res.status}`);
      }

      const cands = data?.candidates;
      if(!Array.isArray(cands) || cands.length===0){
        const rotated = await askRotateConsentAsync("Phản hồi rỗng/blocked (no candidates)");
        if(rotated) return doCall(rotated.key);
        throw new Error("Gemini không trả về kết quả (no candidates).");
      }

      const text = cands[0]?.content?.parts?.map(p=>p.text).join("") || "{}";
      let obj={}; try{ obj=JSON.parse(text.match(/\{[\s\S]*\}$/)?.[0] || text); }catch{}
      return obj;
    }

    const obj = await doCall(cur.key);

    // Chỉ chấp nhận khi khớp 1 đáp án hợp lệ (không chọn bừa)
    if(Number.isInteger(obj.answerIndex) && options[obj.answerIndex]) return obj;
    if(obj.answerText){
      const idx = options.findIndex(o=>lc(o)===lc(obj.answerText));
      if(idx>=0) return {answerText:options[idx], answerIndex:idx};
    }
    throw new Error("Gemini trả JSON không hợp lệ với danh sách đáp án.");
  }

  /* ===== Core per question ===== */
  async function runOnce(){
    const q = getQuestionText();
    const items = getAnswers();
    const options = items.map(it=>it.text);

    const ans = await askGemini(q, options);
    if(!Number.isInteger(ans.answerIndex) || !items[ans.answerIndex]) throw new Error("Không match đáp án nào hợp lệ.");
    enableAndCheck(items[ans.answerIndex].radio);
    return q;
  }

  /* ===== Resume across reloads ===== */
  async function resumeIfNeeded(){
    const st = loadState();
    if(!st.running) return;

    try{
      const q = getQuestionText();
      if(st.lastQHash && st.lastQHash===strHash(q)) return;
    }catch{}

    try{
      const qtext = await runOnce();
      const newHash = strHash(qtext);
      const remain = Math.max(0,(st.remaining||0)-1);

      if(remain<=0){ clearState(); setStatus("Done"); return; }
      saveState({ running:true, remaining:remain, delay:st.delay, lastQHash:newHash });
      await sleep((st.delay||0)*1000);
      clickNext();
    }catch(e){
      console.error("[QuizAuto] resume error:", e);
      clearState();
      alert("Dừng auto: " + e.message);
    }
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
      borderRadius:"12px", width:"260px", fontFamily:"system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      boxShadow:"0 2px 8px rgba(0,0,0,.25)", display:"flex", flexDirection:"column", gap:"8px"
    });

    // Key badge
    const badge=document.createElement("div");
    badge.id="quiz-auto-key-badge";
    badge.style.fontSize="12px"; badge.style.opacity="0.85";

    // Row inputs
    const row1=document.createElement("div"); Object.assign(row1.style,{display:"grid",gridTemplateColumns:"auto 1fr auto 1fr",gap:"8px",alignItems:"center"});
    const labN=document.createElement("div"); labN.textContent="#Q";
    const inN=document.createElement("input"); inN.type="number"; inN.min="1"; inN.step="1"; inN.value=localStorage.getItem(LS_NQ) ?? "1";
    Object.assign(inN.style,{width:"80px",padding:"6px",borderRadius:"8px",border:"1px solid #374151",background:"#111827",color:"#fff"});
    const labD=document.createElement("div"); labD.textContent="Delay(s)";
    const inD=document.createElement("input"); inD.type="number"; inD.min="0"; inD.step="0.5"; inD.value=localStorage.getItem(LS_DELAY) ?? "1";
    Object.assign(inD.style,{width:"80px",padding:"6px",borderRadius:"8px",border:"1px solid #374151",background:"#111827",color:"#fff"});
    row1.append(labN,inN,labD,inD);

    // Auto-rotate toggle
    const rowAuto=document.createElement("label"); rowAuto.style.display="flex"; rowAuto.style.gap="8px"; rowAuto.style.alignItems="center";
    const chkAuto=document.createElement("input"); chkAuto.type="checkbox"; chkAuto.checked=(localStorage.getItem(LS_AUTOROTATE)==="1");
    const txtAuto=document.createElement("span"); txtAuto.textContent="Auto-rotate keys on quota";
    rowAuto.append(chkAuto, txtAuto);

    // Buttons
    const row2=document.createElement("div"); row2.style.display="flex"; row2.style.gap="8px";
    const btnStart=document.createElement("button"); btnStart.textContent="🤖 Start";
    Object.assign(btnStart.style,{flex:"1",padding:"8px",border:"none",borderRadius:"8px",background:"#4f46e5",color:"#fff",fontWeight:"700",cursor:"pointer"});
    const btnStop=document.createElement("button"); btnStop.textContent="⏹ Stop";
    Object.assign(btnStop.style,{flex:"1",padding:"8px",border:"none",borderRadius:"8px",background:"#ef4444",color:"#fff",fontWeight:"700",cursor:"pointer"});
    const btnKeys=document.createElement("button"); btnKeys.textContent="⚙️ Keys";
    Object.assign(btnKeys.style,{padding:"6px 8px",border:"none",borderRadius:"8px",background:"#0f766e",color:"#fff",fontWeight:"700",cursor:"pointer",width:"100%"});

    const status=document.createElement("div"); status.id="quiz-auto-status"; status.textContent="Idle"; status.style.fontSize="12px"; status.style.opacity="0.85";

    // handlers
    btnStart.onclick = ()=>{
      const n=Math.max(1, parseInt(inN.value||"1",10));
      const d=Math.max(0, parseFloat(inD.value||"0"));
      localStorage.setItem(LS_NQ, String(n));
      localStorage.setItem(LS_DELAY, String(d));
      localStorage.setItem(LS_AUTOROTATE, chkAuto.checked ? "1" : "0");
      saveState({ running:true, remaining:n, delay:d, lastQHash:null });
      setStatus(`Running: ${n} q, ${d}s`);
      resumeIfNeeded();
    };
    btnStop.onclick = ()=>{ clearState(); setStatus("Stopped"); };
    btnKeys.onclick = ()=>{
      const keys=getKeys(); const cur=getCurrentKey();
      const msg = [
        "API keys (mỗi dòng 1 key).",
        cur ? `[*] đang dùng key #${cur.idx+1}/${cur.total}` : "[!] chưa có key",
        "",
        ...keys.map((k,i)=> `${(cur && i===cur.idx)?"[*]":"   "} ${k}` ),
        "",
        "Nhập lại toàn bộ keys (để trống = giữ nguyên)."
      ].join("\n");
      const input = prompt(msg, keys.join("\n"));
      if(input===null) return;
      if(input.trim()){
        const arr=input.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        if(arr.length){ setKeys(arr); setKeyIndex(0); updateKeyBadge(); alert(`Đã lưu ${arr.length} key. Đang dùng key #1/${arr.length}.`); }
      }
    };
    chkAuto.onchange = ()=> localStorage.setItem(LS_AUTOROTATE, chkAuto.checked ? "1" : "0");

    row2.append(btnStart, btnStop);
    panel.append(badge, row1, rowAuto, row2, btnKeys, status);

    mountWhenBodyReady(()=>{ document.body.appendChild(panel); updateKeyBadge(); });
  }

  function setStatus(s){ const lab=document.getElementById("quiz-auto-status"); if(lab) lab.textContent=s; }
  function updateKeyBadge(){
    const b=document.getElementById("quiz-auto-key-badge");
    const cur=getCurrentKey();
    if(b) b.textContent = cur ? `Key: #${cur.idx+1}/${cur.total}` : "Key: (none)";
  }

  // Simpler UI bootstrap (robust)
  (function bootstrapUI(){
    if(document.readyState==="loading"){
      document.addEventListener("DOMContentLoaded", addUI, {once:true});
    } else {
      addUI();
    }
  })();

  // Auto-resume without top-level await
  (function autoResume(){
    setTimeout(()=>{
      const st=loadState(); if(!st.running) return;
      // wait up to 15s for DOM question+answers
      const start=Date.now();
      const iv=setInterval(()=>{
        try{ getQuestionText(); getAnswers(); clearInterval(iv); setStatus(`Running: ${st.remaining} left, ${st.delay||0}s`); updateKeyBadge(); resumeIfNeeded(); }
        catch{ if(Date.now()-start>15000){ clearInterval(iv); setStatus("Idle"); } }
      },120);
    },800);
  })();

})();
