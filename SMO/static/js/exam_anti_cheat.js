let warningCount = 0;
let examSubmitted = false;
let proctorStarted = false;   // Chỉ tính vi phạm sau khi HS bật chế độ giám sát
let lastWarningAt = 0;
const MAX_WARNINGS = 3;

function enableFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
        elem.requestFullscreen()
            .then(() => {
                proctorStarted = true;
                const btn = document.getElementById('start-proctor');
                if (btn) btn.classList.add('d-none');
            })
            .catch(err => console.log(err));
    } else {
        proctorStarted = true;
    }
}

// Chuyển tab / thu nhỏ cửa sổ
document.addEventListener("visibilitychange", function () {
    if (document.hidden) triggerCheatWarning("Bạn vừa rời khỏi tab làm bài thi!");
});

// Thoát toàn màn hình
document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement) {
        triggerCheatWarning("Bạn đã thoát chế độ toàn màn hình!");
        const btn = document.getElementById('start-proctor');
        if (btn && !examSubmitted) btn.classList.remove('d-none');
    }
});

document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('copy', event => event.preventDefault());
document.addEventListener('paste', event => {
    if (event.target && event.target.tagName === 'TEXTAREA') event.preventDefault();
});

function triggerCheatWarning(reason) {
    if (!proctorStarted || examSubmitted) return;
    // Một hành động (VD: Alt+Tab) thường bắn cả 2 sự kiện -> chỉ tính 1 lần trong 1.5 giây
    const now = Date.now();
    if (now - lastWarningAt < 1500) return;
    lastWarningAt = now;

    warningCount++;
    const badge = document.getElementById('warning-badge');
    if (badge) badge.innerText = `Cảnh báo gian lận: ${warningCount}/${MAX_WARNINGS}`;

    if (warningCount >= MAX_WARNINGS && typeof submitExam === "function") {
        submitExam(true, `Vi phạm ${MAX_WARNINGS} lần - hệ thống tự động nộp bài.`);
        return;
    }
    alert(`CẢNH BÁO (${warningCount}/${MAX_WARNINGS}): ${reason}\nNếu vi phạm đủ ${MAX_WARNINGS} lần, hệ thống sẽ tự động nộp bài!`);
}

async function startWebcam() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('insecure');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        document.getElementById('proctor-cam').srcObject = stream;
    } catch (err) {
        console.log(err);
        // Trên mạng LAN (http://192.168.x.x) trình duyệt chặn webcam vì không phải HTTPS
        const cam = document.getElementById('proctor-cam');
        if (cam) cam.insertAdjacentHTML('afterend',
            '<div class="small text-danger mt-1">Không bật được webcam (chưa cấp quyền hoặc trang không chạy HTTPS).</div>');
    }
}

function autoSaveAnswers(examId) {
    const form = document.getElementById('exam-form');
    if (!form) return;
    const answers = {};
    new FormData(form).forEach((value, key) => { answers[key] = value; });
    try { localStorage.setItem(`exam_draft_${examId}`, JSON.stringify(answers)); } catch (e) { /* bộ nhớ đầy */ }
}

function restoreAnswers(examId) {
    let answers;
    try { answers = JSON.parse(localStorage.getItem(`exam_draft_${examId}`) || 'null'); } catch (e) { return; }
    if (!answers) return;
    const form = document.getElementById('exam-form');
    for (const [key, value] of Object.entries(answers)) {
        // Duyệt trực tiếp các phần tử thay vì ghép chuỗi selector (tránh lỗi khi đáp án có dấu ")
        const inputs = Array.from(form.elements).filter(el => el.name === key);
        for (const input of inputs) {
            if (input.type === 'radio') {
                if (input.value === value) input.checked = true;
            } else {
                input.value = value;
            }
        }
    }
}
