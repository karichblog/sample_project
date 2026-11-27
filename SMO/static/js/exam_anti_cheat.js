let warningCount = 0;
const MAX_WARNINGS = 3;

function enableFullscreen() {
    let elem = document.documentElement;
    if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(err => console.log(err));
    }
}

document.addEventListener("visibilitychange", function() {
    if (document.hidden) {
        triggerCheatWarning("Bạn vừa rời khỏi tab làm bài thi!");
    }
});

document.addEventListener("fullscreenchange", function() {
    if (!document.fullscreenElement) {
        triggerCheatWarning("Bạn đã thoát chế độ toàn màn hình!");
    }
});

document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('copy', event => event.preventDefault());

function triggerCheatWarning(reason) {
    warningCount++;
    const badge = document.getElementById('warning-badge');
    if (badge) {
        badge.innerText = `Cảnh báo gian lận: ${warningCount}/${MAX_WARNINGS}`;
    }
    alert(`CẢNH BÁO (${warningCount}/${MAX_WARNINGS}): ${reason}\nNếu vi phạm quá ${MAX_WARNINGS} lần, hệ thống sẽ tự động nộp bài!`);
    
    if (warningCount >= MAX_WARNINGS && typeof submitExam === "function") {
        submitExam(true);
    }
}

async function startWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        document.getElementById('proctor-cam').srcObject = stream;
    } catch (err) {
        alert("Không tìm thấy Webcam hoặc chưa cấp quyền truy cập camera!");
    }
}

function autoSaveAnswers(examId) {
    const form = document.getElementById('exam-form');
    if (!form) return;
    const formData = new FormData(form);
    let answers = {};
    formData.forEach((value, key) => { answers[key] = value; });
    localStorage.setItem(`exam_draft_${examId}`, JSON.stringify(answers));
}

function restoreAnswers(examId) {
    const saved = localStorage.getItem(`exam_draft_${examId}`);
    if (saved) {
        const answers = JSON.parse(saved);
        for (const [key, value] of Object.entries(answers)) {
            const input = document.querySelector(`[name="${key}"][value="${value}"]`) || document.querySelector(`[name="${key}"]`);
            if (input) {
                if (input.type === 'radio') input.checked = true;
                else input.value = value;
            }
        }
    }
}
