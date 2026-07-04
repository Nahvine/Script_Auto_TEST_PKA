// ==UserScript==
// @name         Quiz Auto (Lazy) — Strict Memory + Random Pick + Harvest + Fill-in-Blanks
// @namespace    vanh-quiz-auto
// @version      4.0
// @description  Tự động khoanh + điền ô trống. Học đáp án đúng từ trang review. 100% Free & Fast.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    /* ===== Consts & Storage ===== */
    const LS_NQ    = "quiz_auto_num_questions";
    const LS_DELAY = "quiz_auto_delay_secs";
    const SS_STATE = "quiz_auto_state_v1";
    const LS_MEM   = "quiz_auto_memory_v1";
    // Fill-in-blanks memory: LS_FIBMEM[qKey][blankName] = { correct: string, wrong: string[] }
    const LS_FIBMEM = "quiz_auto_fib_memory_v1";

    const SELECTORS = {
        QUESTION_VISIBLE: "[id^='question_'][id$='_question_text'].question_text",
        QUESTION_HIDDEN:  ".original_question_text textarea[name='question_text']",
        ANSWER_BLOCKS:    ".answers .answer",
        ANSWER_LABEL:     ".answer_label, .answer_text",
        ANSWER_RADIO:     "input[type='radio'].question_input",
        NEXT_BUTTON:      "button.next-question",
        FIB_QUESTION:     ".fill_in_multiple_blanks_question",
        FIB_INPUT:        "input.question_input[name]"
    };

    /* ===== Utils ===== */
    const normWS = s => (s || "").replace(/\s+/g, " ").trim();
    const sleep  = ms => new Promise(r => setTimeout(r, ms));
    function strHash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return String(h); }
    function stripDiacritics(str) { return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
    function normalizeText(s) {
        const a = normWS(s).toLowerCase().replace(/[""\"':,.!?()[\]{}•*<>/\\|;~^`+=_-]+/g, " ").replace(/\s+/g, " ").trim();
        return { raw: s || "", n: a, na: stripDiacritics(a) };
    }
    function sameText(a, b) { return !!(a && b) && (a.n === b.n || a.na === b.na); }
    function qKeyOf(s) { const t = normalizeText(s); return (t.na || t.n).slice(0, 400); }

    /* ===== MCQ Memory ===== */
    function loadMem()  { try { return JSON.parse(localStorage.getItem(LS_MEM) || "{}"); } catch { return {}; } }
    function saveMem(m) { localStorage.setItem(LS_MEM, JSON.stringify(m || {})); updateMemStats(); }
    function ensureEntry(mem, qKey) {
        if (!mem[qKey]) mem[qKey] = { wrong: [], options: [] };
        if (!Array.isArray(mem[qKey].wrong))   mem[qKey].wrong = [];
        if (!Array.isArray(mem[qKey].options)) mem[qKey].options = [];
        return mem[qKey];
    }
    function pushUnique(arr, t) {
        if (!t || !t.n) return;
        if (!arr.some(x => x.n === t.n || x.na === t.na)) arr.push(t);
    }
    function setCorrectText(qKey, raw) {
        const mem = loadMem(); const e = ensureEntry(mem, qKey);
        e.correct = normalizeText(raw); pushUnique(e.options, e.correct); saveMem(mem);
    }
    function addWrongText(qKey, raw) {
        const mem = loadMem(); const e = ensureEntry(mem, qKey);
        const t = normalizeText(raw); pushUnique(e.wrong, t); pushUnique(e.options, t); saveMem(mem);
    }
    function setQuestionRaw(qKey, qRaw) {
        const mem = loadMem(); const e = ensureEntry(mem, qKey);
        if (qRaw && (!e.qRaw || e.qRaw.length < qRaw.length)) e.qRaw = qRaw;
        saveMem(mem);
    }
    function mergeOptionsText(qKey, answersArray) {
        if (!Array.isArray(answersArray)) return;
        const mem = loadMem(); const e = ensureEntry(mem, qKey);
        for (const raw of answersArray) pushUnique(e.options, normalizeText(raw));
        saveMem(mem);
    }
    function migrateEntryWithOptions(entry, optionsMeta) {
        if (!entry) return;
        if (!Array.isArray(entry.options)) entry.options = [];
        if (entry.correct && entry.correct.n) pushUnique(entry.options, entry.correct);
        if (Number.isInteger(entry.correctIndex) && optionsMeta[entry.correctIndex] && !(entry.correct && entry.correct.n)) {
            entry.correct = normalizeText(optionsMeta[entry.correctIndex].raw);
            pushUnique(entry.options, entry.correct);
        }
        if (entry.wrong && entry.wrong.length && typeof entry.wrong[0] === "number") {
            const newWrong = [];
            for (const wi of entry.wrong) {
                if (Number.isInteger(wi) && optionsMeta[wi]) {
                    const t = normalizeText(optionsMeta[wi].raw);
                    pushUnique(newWrong, t); pushUnique(entry.options, t);
                }
            }
            entry.wrong = newWrong;
        }
    }

    /* ===== Fill-in-Blanks (FIB) Memory ===== */
    // Structure: { [qKey]: { [blankName]: { correct: string } } }
    function loadFIBMem()  { try { return JSON.parse(localStorage.getItem(LS_FIBMEM) || "{}"); } catch { return {}; } }
    function saveFIBMem(m) { localStorage.setItem(LS_FIBMEM, JSON.stringify(m || {})); updateMemStats(); }

    function setFIBCorrect(qKey, blankName, correctValue) {
        if (!qKey || !blankName || correctValue === undefined || correctValue === null) return;
        const mem = loadFIBMem();
        if (!mem[qKey]) mem[qKey] = {};
        mem[qKey][blankName] = { correct: correctValue };
        saveFIBMem(mem);
    }
    function getFIBCorrect(qKey, blankName) {
        const mem = loadFIBMem();
        return mem[qKey]?.[blankName]?.correct ?? null;
    }
    function getFIBEntry(qKey) {
        return loadFIBMem()[qKey] || null;
    }
    function fibStats() {
        const mem = loadFIBMem();
        let qCount = 0, blankCount = 0;
        for (const k in mem) {
            if (!mem[k]) continue;
            const blanks = Object.keys(mem[k]);
            if (blanks.length) { qCount++; blankCount += blanks.length; }
        }
        return { qCount, blankCount };
    }

    /* ===== Persistent State ===== */
    function loadState() { try { return JSON.parse(sessionStorage.getItem(SS_STATE) || "{}"); } catch { return {}; } }
    function saveState(st) { sessionStorage.setItem(SS_STATE, JSON.stringify(st || {})); }
    function clearState() { sessionStorage.removeItem(SS_STATE); }

    /* ===== DOM helpers ===== */
    function getQuestionText() {
        const el = document.querySelector(SELECTORS.QUESTION_VISIBLE);
        if (el && normWS(el.innerText)) return normWS(el.innerText);
        const hidden = document.querySelector(SELECTORS.QUESTION_HIDDEN);
        if (hidden && normWS(hidden.value)) return normWS(hidden.value);
        throw new Error("Không tìm thấy text câu hỏi");
    }
    
    function getQuizQuestionBlocks() {
        const set = new Set();
        const out = [];
        const selectors = [
            ".display_question.question",
            ".question_holder",
            ".question",
            ".display_question"
        ];
        for (const s of selectors) {
            document.querySelectorAll(s).forEach(el => {
                const hasText = !!el.querySelector(".question_text, .original_question_text textarea[name='question_text']");
                if (hasText && !set.has(el)) {
                    set.add(el);
                    out.push(el);
                }
            });
        }
        // Lọc bỏ các block con nằm bên trong block khác để tránh xử lý trùng
        return out.filter(el => !out.some(other => other !== el && other.contains(el)));
    }

    function enableAndCheck(radio) {
        radio.removeAttribute("disabled"); radio.disabled = false; radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        radio.dispatchEvent(new Event("input",  { bubbles: true }));
    }
    function fillInput(inputEl, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (nativeInputValueSetter) nativeInputValueSetter.call(inputEl, value);
        else inputEl.value = value;
        inputEl.dispatchEvent(new Event("input",  { bubbles: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function clickNext()   { const btn = document.querySelector(SELECTORS.NEXT_BUTTON); if (btn) btn.click(); }
    function clickSubmit() {
        const btn = document.getElementById("submit_quiz_button") || document.querySelector(".btn.submit_button.quiz_submit");
        if (btn) { btn.click(); setStatus("Submitted!"); }
        else { setStatus("Done (Submit btn not found)"); }
    }

    function processQuestionBlock(block) {
        // 1. Lấy text câu hỏi
        let qText = "";
        const q1 = block.querySelector("[id^='question_'][id$='_question_text'].question_text");
        const q2 = block.querySelector(".original_question_text textarea[name='question_text']");
        if (q1 && normWS(q1.innerText)) qText = normWS(q1.innerText);
        else if (q2 && normWS(q2.value)) qText = normWS(q2.value);
        else {
            const h = block.querySelector(".question_text, .text, h3, h4");
            if (h) qText = normWS(h.innerText || h.textContent || "");
        }
        if (!qText) return null;

        const key = qKeyOf(qText);

        // 2. Nhận dạng FIB hay MCQ
        const isFIB = block.classList.contains("fill_in_multiple_blanks_question") || 
                      (!!block.querySelector("input.question_input[type='text'][name]") && !block.querySelector("input.question_input[type='radio']"));

        if (isFIB) {
            const inputs = [...block.querySelectorAll("input.question_input[type='text'][name]")]
                .map(el => ({ name: el.getAttribute("name"), el }))
                .filter(x => x.name);
            if (!inputs.length) return qText;
            const entry = getFIBEntry(key);
            let filledCount = 0;
            for (const { name, el } of inputs) {
                const val = entry?.[name]?.correct ?? null;
                if (val !== null && val !== "") {
                    fillInput(el, val);
                    filledCount++;
                }
            }
            return qText;
        } else {
            // MCQ (Trắc nghiệm)
            const answerBlocks = [...block.querySelectorAll(".answers .answer, .answer")];
            const items = answerBlocks.map((b, idx) => {
                const label = b.querySelector(SELECTORS.ANSWER_LABEL);
                const raw = label ? (label.innerText || label.textContent || "") : "";
                return { idx, raw: normWS(raw), t: normalizeText(raw), radio: b.querySelector(SELECTORS.ANSWER_RADIO), el: b };
            }).filter(x => x.raw && x.radio);

            if (!items.length) return qText;

            const mem = loadMem();
            const entry = mem[key];
            const opts = items.map(it => ({ idx: it.idx, raw: it.raw, t: it.t }));

            setQuestionRaw(key, qText);
            mergeOptionsText(key, opts.map(o => o.raw));
            if (entry) migrateEntryWithOptions(entry, opts);

            const freshMem = loadMem();
            const ent = freshMem[key];

            // Có đáp án đúng -> chọn
            if (ent && ent.correct && ent.correct.n) {
                const pick = opts.find(o => sameText(o.t, ent.correct));
                if (pick) { enableAndCheck(items[pick.idx].radio); return qText; }
            }

            // Loại trừ sai
            let allowed = opts.slice();
            if (ent && Array.isArray(ent.wrong) && ent.wrong.length) {
                allowed = allowed.filter(o => !ent.wrong.some(w => sameText(o.t, w)));
                if (!allowed.length) allowed = opts.slice();
            }
            if (allowed.length === 1) { enableAndCheck(items[allowed[0].idx].radio); return qText; }

            // Random pick
            if (allowed.length > 0) {
                const pick = allowed[Math.floor(Math.random() * allowed.length)];
                enableAndCheck(items[pick.idx].radio);
                return qText;
            }
            return qText;
        }
    }

    /* ===== Core per question ===== */
    async function runOnce() {
        const blocks = getQuizQuestionBlocks();
        if (!blocks.length) throw new Error("Không tìm thấy block câu hỏi nào");

        let firstQText = "";
        let fibCount = 0;
        let mcqCount = 0;

        for (const block of blocks) {
            const qText = processQuestionBlock(block);
            if (qText) {
                if (!firstQText) firstQText = qText;
                const isFIB = block.classList.contains("fill_in_multiple_blanks_question") || 
                              (!!block.querySelector("input.question_input[type='text'][name]") && !block.querySelector("input.question_input[type='radio']"));
                if (isFIB) fibCount++; else mcqCount++;
            }
        }

        setStatus(`Đã làm: ${blocks.length} câu (${mcqCount} MCQ, ${fibCount} FIB)`);
        return firstQText || "multi-questions-page";
    }

    /* ===== Review-page: Harvest ===== */
    function getAllQuestionBlocksOnReviewPage() {
        const sels = [
            ".display_question.question.multiple_choice_question",
            ".display_question.multiple_choice_question",
            ".question.multiple_choice_question",
            ".display_question.question.fill_in_multiple_blanks_question",
            ".display_question.fill_in_multiple_blanks_question",
            ".quiz_sortable .display_question.question",
        ];
        const set = new Set(); const out = [];
        for (const s of sels) document.querySelectorAll(s).forEach(n => { if (!set.has(n)) { set.add(n); out.push(n); } });
        return out;
    }
    function findChosenIndex(block, answerBlocks) {
        const sel = block.querySelector(".answer.selected_answer") || block.querySelector(".selected_answer");
        if (sel) { const idx = answerBlocks.indexOf(sel.closest(".answer") || sel); if (idx >= 0) return idx; }
        for (let i = 0; i < answerBlocks.length; i++) {
            const r = answerBlocks[i].querySelector("input[type='radio'].question_input");
            if (r && (r.checked || r.hasAttribute("checked"))) return i;
        }
        for (let i = 0; i < answerBlocks.length; i++) {
            if (/You selected this answer/i.test(answerBlocks[i].getAttribute("title") || "")) return i;
        }
        for (let i = 0; i < answerBlocks.length; i++) {
            const r = answerBlocks[i].querySelector("input[type='radio']");
            if (r && r.getAttribute("aria-checked") === "true") return i;
        }
        return -1;
    }
    function parseQuestionBlock(block) {
        const isIncorrect = block.classList.contains("incorrect") || !!block.querySelector(".answer_arrow.incorrect");
        let qText = "";
        const q1 = block.querySelector("[id^='question_'][id$='_question_text'].question_text");
        const q2 = block.querySelector(".original_question_text textarea[name='question_text']");
        if (q1 && q1.innerText) qText = q1.innerText;
        else if (q2 && q2.value) qText = q2.value;
        else { const h = block.querySelector(".question_text, .text, h3, h4, .name.question_name"); if (h) qText = h.innerText || h.textContent || ""; }
        qText = normWS(qText);
        if (!qText) return { error: "no_question_text" };

        // Detect FIB
        if (block.classList.contains("fill_in_multiple_blanks_question")) {
            return parseQuestionBlockFIB(block, qText, isIncorrect);
        }

        const answerBlocks = Array.from(block.querySelectorAll(".answers .answer"));
        if (!answerBlocks.length) return { error: "no_answers", qText };
        const chosenIdx = findChosenIndex(block, answerBlocks);
        if (chosenIdx < 0) return { error: "no_chosen", qText };
        const texts = answerBlocks.map(a => { const t = a.querySelector(SELECTORS.ANSWER_LABEL); return normWS(t && (t.innerText || t.textContent) || ""); });
        return { type: "mcq", qText, qKey: qKeyOf(qText), isIncorrect, chosenIdx, chosenText: texts[chosenIdx] || "", answers: texts };
    }

    /**
     * Parse FIB block trên trang review.
     * Canvas LMS hiển thị ô điền dạng:
     *   - input[name] có value là câu trả lời người dùng đã điền
     *   - Câu đúng thường xuất hiện trong .correct_answer hoặc data attribute
     *   - Nếu câu sai: .answer_arrow.incorrect tồn tại
     * Chiến lược:
     *   1. Luôn đọc giá trị input (đây là thứ user đã điền)
     *   2. Nếu câu đúng (không có incorrect): lưu value của input là correct
     *   3. Tìm thêm hint "correct answer" trong DOM nếu câu sai
     */
    function parseQuestionBlockFIB(block, qText, isIncorrect) {
        const qKey = qKeyOf(qText);
        const inputs = [...block.querySelectorAll("input.question_input[type='text'][name]")];
        if (!inputs.length) return { error: "no_fib_inputs", qText };

        const blanks = inputs.map(inp => {
            const name  = inp.getAttribute("name");
            const value = (inp.value || "").trim();
            // Tìm "correct answer" hint kế bên: Canvas thường có span.answer_text hoặc
            // .correct_answer sau khi submit trong cùng container
            let correctHint = null;
            // Cách 1: .correct_answer trong cùng list item / paragraph chứa input
            const parent = inp.closest("li, p, div") || inp.parentElement;
            if (parent) {
                const ca = parent.querySelector(".correct_answer, [data-correct]");
                if (ca) correctHint = normWS(ca.textContent || ca.value || "");
            }
            // Cách 2: aria-label hoặc data attribute trên input
            if (!correctHint) {
                correctHint = inp.getAttribute("data-correct") || null;
                if (correctHint) correctHint = correctHint.trim();
            }
            return { name, value, correctHint };
        });

        return { type: "fib", qText, qKey, isIncorrect, blanks };
    }

    function harvestQA() {
        const blocks = getAllQuestionBlocksOnReviewPage();
        if (!blocks.length) { alert("Không tìm thấy block câu hỏi để thu thập."); return; }
        const seen = new Set();
        let learnedCorrect = 0, learnedWrong = 0, learnedFIB = 0, skipped = 0;
        let errNoQ = 0, errNoAns = 0, errNoChosen = 0;

        for (const b of blocks) {
            const info = parseQuestionBlock(b);
            if (!info) { skipped++; continue; }
            if (info.error) {
                if (info.error === "no_question_text") errNoQ++;
                else if (info.error === "no_answers" || info.error === "no_fib_inputs") errNoAns++;
                else if (info.error === "no_chosen") errNoChosen++;
                skipped++; continue;
            }
            if (seen.has(info.qKey)) { skipped++; continue; }
            seen.add(info.qKey);

            // --- FIB ---
            if (info.type === "fib") {
                const existing = getFIBEntry(info.qKey);
                let alreadyHasAll = true;
                for (const blank of info.blanks) {
                    const savedVal = existing?.[blank.name]?.correct;
                    const toLearn = !info.isIncorrect ? (blank.correctHint || blank.value) : blank.correctHint;
                    if (toLearn && toLearn !== savedVal) {
                        alreadyHasAll = false;
                    }
                }

                if (alreadyHasAll) {
                    skipped++;
                    continue;
                }

                let savedAny = false;
                for (const { name, value, correctHint } of info.blanks) {
                    const toSave = !info.isIncorrect ? (correctHint || value) : correctHint;
                    if (toSave) {
                        const existingVal = existing?.[name]?.correct;
                        if (existingVal !== toSave) {
                            setFIBCorrect(info.qKey, name, toSave);
                            learnedFIB++;
                            savedAny = true;
                        }
                    }
                }
                if (!savedAny) skipped++;
                continue;
            }

            // --- MCQ ---
            setQuestionRaw(info.qKey, info.qText);
            mergeOptionsText(info.qKey, info.answers);
            if (info.isIncorrect) {
                const before = (loadMem()[info.qKey]?.wrong?.length) || 0;
                addWrongText(info.qKey, info.chosenText);
                const after = (loadMem()[info.qKey]?.wrong?.length) || 0;
                if (after > before) learnedWrong++; else skipped++;
            } else {
                const beforeHad = !!(loadMem()[info.qKey]?.correct?.n);
                setCorrectText(info.qKey, info.chosenText);
                const afterHad = !!(loadMem()[info.qKey]?.correct?.n);
                if (!beforeHad && afterHad) learnedCorrect++; else skipped++;
            }
        }
        updateMemStats();
        alert(`Harvest xong:\n- MCQ correct: ${learnedCorrect}\n- MCQ wrong:   ${learnedWrong}\n- FIB blanks:  ${learnedFIB}\n- Skipped:     ${skipped}\n  └─ NoQ:${errNoQ}, NoAns:${errNoAns}, NoChosen:${errNoChosen}`);
    }

    /* ===== Export từ PAGE ===== */
    function exportCorrectQAFromPage() {
        const blocks = getAllQuestionBlocksOnReviewPage();
        if (!blocks.length) { alert("Không tìm thấy block câu hỏi để export (page)."); return; }
        const dataset = []; const seen = new Set();
        let errNoQ = 0, errNoAns = 0, errNoChosen = 0, filteredIncorrect = 0, dedup = 0;
        for (const b of blocks) {
            const info = parseQuestionBlock(b);
            if (!info) continue;
            if (info.error) { if (info.error === "no_question_text") errNoQ++; else if (info.error === "no_answers" || info.error === "no_fib_inputs") errNoAns++; else if (info.error === "no_chosen") errNoChosen++; continue; }
            if (info.isIncorrect) { filteredIncorrect++; continue; }
            if (seen.has(info.qKey)) { dedup++; continue; }
            seen.add(info.qKey);
            if (info.type === "fib") {
                dataset.push({ type: "fib", question: info.qText, blanks: info.blanks.map(b => ({ name: b.name, correct: b.correctHint || b.value })) });
            } else {
                dataset.push({ type: "mcq", question: info.qText, answers: info.answers, correctIndex: info.chosenIdx, correctText: info.chosenText });
            }
        }
        if (!dataset.length) { alert(`Không có câu đúng nào để export.\nSkipped -> NoQ:${errNoQ}, NoAns:${errNoAns}, NoChosen:${errNoChosen}, IncorrectFiltered:${filteredIncorrect}`); return; }
        const json = JSON.stringify(dataset, null, 2);
        downloadFile(json, "quiz_correct_page.json", "application/json;charset=utf-8");
        alert(`Exported (page): ${dataset.length}.\nDedup:${dedup}, IncorrectFiltered:${filteredIncorrect}`);
    }

    /* ===== Export từ MEMORY ===== */
    function exportMemoryQA() {
        const mem = loadMem(); const fibMem = loadFIBMem();
        const entries = [];
        // MCQ entries
        for (const k in mem) {
            const e = mem[k];
            if (!e || !(e.correct && e.correct.n)) continue;
            const question = e.qRaw || k;
            let answersRaw = [];
            if (Array.isArray(e.options) && e.options.length) {
                const uniq = []; const seenN = new Set();
                for (const opt of e.options) { if (!opt || !opt.n || seenN.has(opt.n)) continue; seenN.add(opt.n); uniq.push(opt); }
                if (!uniq.some(o => sameText(o, e.correct))) uniq.unshift(e.correct);
                answersRaw = uniq.map(o => o.raw);
            } else {
                const wrongs = Array.isArray(e.wrong) ? e.wrong : [];
                const uniq = []; const seenSet = new Set();
                uniq.push(e.correct); seenSet.add(e.correct.n);
                for (const w of wrongs) { if (w && w.n && !seenSet.has(w.n)) { seenSet.add(w.n); uniq.push(w); } }
                answersRaw = uniq.map(o => o.raw);
            }
            let correctIndex = answersRaw.findIndex(r => sameText(normalizeText(r), e.correct));
            if (correctIndex < 0) { answersRaw = [e.correct.raw, ...answersRaw.filter(r => !sameText(normalizeText(r), e.correct))]; correctIndex = 0; }
            entries.push({ type: "mcq", question, answers: answersRaw, correctIndex, correctText: e.correct.raw });
        }
        // FIB entries
        for (const k in fibMem) {
            const entry = fibMem[k];
            if (!entry) continue;
            const blanks = Object.entries(entry).map(([name, v]) => ({ name, correct: v.correct }));
            if (!blanks.length) continue;
            entries.push({ type: "fib", question: k, blanks });
        }
        if (!entries.length) { alert("Memory chưa có câu nào để export."); return; }
        const json = JSON.stringify(entries, null, 2);
        downloadFile(json, "quiz_memory_export.json", "application/json;charset=utf-8");
        alert(`Exported from MEMORY: ${entries.length} items (MCQ + FIB).`);
    }

    /* ===== CSV ===== */
    function toCSV(items) {
        const maxAns = Math.max(...items.map(it => (it.answers || []).length));
        const headers = ["question", ...Array.from({ length: maxAns }, (_, i) => `answer_${i + 1}`), "correct_index"];
        const lines = [headers.join(",")];
        for (const it of items) {
            if (it.type === "fib") continue; // CSV không hỗ trợ FIB tốt, skip
            const row = [csvEscape(it.question)];
            for (let i = 0; i < maxAns; i++) row.push(csvEscape(it.answers[i] ?? ""));
            row.push(String(it.correctIndex));
            lines.push(row.join(","));
        }
        return lines.join("\n");
    }
    function csvEscape(s) {
        const t = (s ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
        if (/[",]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
        return t;
    }
    function downloadFile(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    }

    /* ===== Memory stats ===== */
    function memStats() {
        const mem = loadMem();
        let total = 0, correctQ = 0, wrongQ = 0, wrongChoices = 0, withOptions = 0;
        for (const k in mem) {
            total++;
            if (mem[k]?.correct?.n) correctQ++;
            if (Array.isArray(mem[k]?.wrong) && mem[k].wrong.length) { wrongQ++; wrongChoices += mem[k].wrong.length; }
            if (Array.isArray(mem[k]?.options) && mem[k].options.length) withOptions++;
        }
        return { total, correctQ, wrongQ, wrongChoices, withOptions };
    }
    function updateMemStats() {
        const el = document.getElementById("quiz-auto-memstats"); if (!el) return;
        const { total, correctQ, wrongQ, wrongChoices } = memStats();
        const { qCount, blankCount } = fibStats();
        el.textContent = `📊 MCQ: ${total}Q (✓${correctQ} ✗${wrongQ} × ${wrongChoices}) | FIB: ${qCount}Q (${blankCount} blanks)`;
    }

    /* ===== Resume loop ===== */
    let isProcessing = false;
    async function resumeIfNeeded() {
        if (isProcessing) return;
        const st = loadState(); if (!st.running) return;
        try {
            const q = getQuestionText();
            if (st.lastQHash && st.lastQHash === strHash(q)) return;
        } catch { return; }
        isProcessing = true;
        try {
            const qtext = await runOnce();
            const newHash = strHash(qtext);
            const remain = Math.max(0, (st.remaining || 0) - 1);
            if (remain <= 0) { clearState(); setStatus("Done -> Submitting..."); await sleep(1000); clickSubmit(); return; }
            saveState({ running: true, remaining: remain, delay: st.delay, lastQHash: newHash });
            await sleep((st.delay || 0) * 1000);
            clickNext();
        } catch (e) {
            console.error("[QuizAuto] resume error:", e);
        } finally {
            isProcessing = false;
        }
    }

    /* ===== UI ===== */
    function mountWhenBodyReady(cb) {
        if (document.body) { cb(); return; }
        const iv = setInterval(() => { if (document.body) { clearInterval(iv); cb(); } }, 50);
    }

    function addUI() {
        if (document.getElementById("quiz-auto-panel")) return;
        const panel = document.createElement("div");
        panel.id = "quiz-auto-panel";
        Object.assign(panel.style, {
            position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647,
            background: "rgba(17,24,39,.93)", color: "#fff", padding: "12px",
            borderRadius: "12px", width: "340px",
            fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
            boxShadow: "0 2px 12px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", gap: "8px"
        });

        // Title
        const title = document.createElement("div");
        title.textContent = "🤖 Quiz Auto v4";
        Object.assign(title.style, { fontWeight: "700", fontSize: "13px", letterSpacing: ".03em" });

        // Stats
        const memstats = document.createElement("div");
        memstats.id = "quiz-auto-memstats";
        Object.assign(memstats.style, { fontSize: "11px", opacity: "0.85", lineHeight: "1.5" });

        // Row: #Q + Delay
        const row1 = document.createElement("div");
        Object.assign(row1.style, { display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "8px", alignItems: "center" });
        const labN = document.createElement("div"); labN.textContent = "#Q";
        const inN  = document.createElement("input"); inN.type = "number"; inN.min = "1"; inN.step = "1"; inN.value = localStorage.getItem(LS_NQ) ?? "1";
        Object.assign(inN.style, { width: "100%", padding: "6px", borderRadius: "8px", border: "1px solid #374151", background: "#111827", color: "#fff" });
        let savedD = 4;
        const savedDRaw = localStorage.getItem(LS_DELAY);
        if (savedDRaw !== null) savedD = parseFloat(savedDRaw); else localStorage.setItem(LS_DELAY, "4");
        const labD = document.createElement("div"); labD.textContent = "Delay(s)";
        const inD  = document.createElement("input"); inD.type = "number"; inD.min = "0"; inD.step = "0.5"; inD.value = savedD;
        Object.assign(inD.style, { width: "100%", padding: "6px", borderRadius: "8px", border: "1px solid #374151", background: "#111827", color: "#fff" });
        row1.append(labN, inN, labD, inD);

        // Row: Start / Stop
        const row2 = document.createElement("div");
        Object.assign(row2.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
        const btnStart = document.createElement("button"); btnStart.textContent = "▶ Start Loop";
        Object.assign(btnStart.style, { padding: "8px", border: "none", borderRadius: "8px", background: "#4f46e5", color: "#fff", fontWeight: "700", cursor: "pointer" });
        const btnStop  = document.createElement("button"); btnStop.textContent = "⏹ Stop";
        Object.assign(btnStop.style, { padding: "8px", border: "none", borderRadius: "8px", background: "#ef4444", color: "#fff", fontWeight: "700", cursor: "pointer" });
        row2.append(btnStart, btnStop);

        // Harvest button
        const btnHarvest = document.createElement("button"); btnHarvest.textContent = "📥 Harvest Q/A (review page)";
        Object.assign(btnHarvest.style, { padding: "8px", border: "none", borderRadius: "8px", background: "#2563eb", color: "#fff", fontWeight: "700", cursor: "pointer", width: "100%" });

        // Export memory
        const btnExport = document.createElement("button"); btnExport.textContent = "💾 Export Memory";
        Object.assign(btnExport.style, { padding: "8px", border: "none", borderRadius: "8px", background: "#7c3aed", color: "#fff", fontWeight: "700", cursor: "pointer", width: "100%" });

        // Delete memory
        const btnDelete = document.createElement("button"); btnDelete.textContent = "🗑 Delete ALL Memory";
        Object.assign(btnDelete.style, { padding: "8px", border: "none", borderRadius: "8px", background: "#9ca3af", color: "#111827", fontWeight: "800", cursor: "pointer", width: "100%" });

        // Status
        const status = document.createElement("div");
        status.id = "quiz-auto-status"; status.textContent = "Idle";
        Object.assign(status.style, { fontSize: "12px", opacity: "0.85" });

        // Events
        btnStart.onclick = () => {
            const n = Math.max(1, parseInt(inN.value || "1", 10));
            const d = Math.max(0, parseFloat(inD.value || "0"));
            localStorage.setItem(LS_NQ, String(n)); localStorage.setItem(LS_DELAY, String(d));
            saveState({ running: true, remaining: n, delay: d, lastQHash: null });
            setStatus(`Running: ${n} q, ${d}s`); resumeIfNeeded();
        };
        btnStop.onclick = () => { clearState(); setStatus("Stopped"); };
        btnHarvest.onclick = harvestQA;
        btnExport.onclick = exportMemoryQA;
        btnDelete.onclick = () => {
            if (!confirm("Xoá toàn bộ memory (MCQ + FIB)?")) return;
            localStorage.removeItem(LS_MEM); localStorage.removeItem(LS_FIBMEM);
            updateMemStats(); alert("Đã xoá toàn bộ memory.");
        };

        panel.append(title, memstats, row1, row2, btnHarvest, btnExport, btnDelete, status);
        mountWhenBodyReady(() => { document.body.appendChild(panel); updateMemStats(); });
    }

    function setStatus(s) { const lab = document.getElementById("quiz-auto-status"); if (lab) lab.textContent = s; }

    (function bootstrapUI() {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addUI, { once: true });
        else addUI();
    })();
    (function autoResume() {
        setTimeout(() => {
            setInterval(() => {
                const st = loadState();
                if (!st.running) { setStatus("Idle"); return; }
                updateMemStats();
                resumeIfNeeded();
            }, 120);
        }, 800);
    })();
})();
