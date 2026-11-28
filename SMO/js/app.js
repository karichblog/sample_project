/* =====================================================================
 * GIAO DIỆN & CHỨC NĂNG — ứng dụng một trang (SPA), điều hướng bằng #hash
 *   #/login, #/dashboard, #/course/<id>, #/exam/<id>, #/result/<id>
 * ===================================================================== */

const app = document.getElementById('app');
let flashes = [];
let pageCleanup = null;
const ROLE_LABELS = { admin: 'Quản trị', teacher: 'Giáo viên', student: 'Học sinh' };  // Hàm dọn dẹp (timer, listener) khi rời trang thi

/* ---------- Tiện ích ---------- */
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function flash(msg, type = 'success') { flashes.push({ msg, type }); }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function userName(id) { const u = byId('users', id); return u ? u.full_name : 'N/A'; }
function courseName(id) { const c = byId('courses', id); return c ? c.name : ''; }
function examTitle(id) { const e = byId('exams', id); return e ? e.title : `Đề #${id}`; }
function canManageCourse(user, course) {
    return !!course && (user.role === 'admin' || (user.role === 'teacher' && course.teacher_id === user.id));
}
function managedCourses(user) {
    return user.role === 'admin' ? DB.courses : DB.courses.filter(c => c.teacher_id === user.id);
}
function pinActive(c) {
    return c.pin && c.pin_created_at && Date.now() - c.pin_created_at <= PIN_VALID_MINUTES * 60000;
}
function statusBadge(st) {
    const cls = st === 'Có mặt' ? 'success' : (st === 'Đi muộn' ? 'warning text-dark' : 'danger');
    return `<span class="badge bg-${cls}">${esc(st)}</span>`;
}
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB'; }
function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportExcel(rows, sheet, filename) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet);
    XLSX.writeFile(wb, filename);
}
function scoreHtml(v) { return `<span class="score">${esc(v)}<small>/10</small></span>`; }
function pageTitle(title, sub) {
    return `<div class="page-title"><h3>${esc(title)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
}
function todayLong() {
    const d = new Date();
    const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
    return `${days[d.getDay()]}, ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
}
const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="text-muted">${text}</td></tr>`;

/* ---------- Khung trang ---------- */
function layout(user, content) {
    const nav = user ? `
        <div class="nav-user">
            <span><b>${esc(user.full_name)}</b></span>
            <span class="role-chip">${ROLE_LABELS[user.role] || esc(user.role)}</span>
            <button class="btn-logout" data-act="logout">Đăng xuất</button>
        </div>` : '';
    const msgs = flashes.map(f => `<div class="alert alert-${esc(f.type)} py-2">${esc(f.msg)}</div>`).join('');
    flashes = [];
    return `
    <nav class="navbar navbar-dark bg-primary px-4">
        <a class="navbar-brand" href="#/dashboard">Sổ Lớp Offline</a>${nav}
    </nav>
    <div class="container mt-4 mb-5">${msgs}${content}</div>`;
}

/* =====================================================================
 * ĐIỀU HƯỚNG
 * ===================================================================== */
function render() {
    if (pageCleanup) { pageCleanup(); pageCleanup = null; }
    loadDB();
    const [route, id] = location.hash.replace(/^#\/?/, '').split('/');
    const user = currentUser();
    if (!user) {
        if (route && route !== 'login') { location.hash = '#/login'; return; }
        app.innerHTML = layout(null, viewLogin());
        return;
    }
    let html;
    switch (route) {
        case 'course': html = viewCourse(user, Number(id)); break;
        case 'exam': html = viewExam(user, Number(id)); break;
        case 'result': html = viewResult(user, Number(id)); break;
        case 'dashboard': case '': case 'login': case undefined:
            html = user.role === 'admin' ? viewAdmin(user) : user.role === 'teacher' ? viewTeacher(user) : viewStudent(user);
            if (route !== 'dashboard') { history.replaceState(null, '', '#/dashboard'); }
            break;
        default: html = viewError('Không tìm thấy trang yêu cầu.');
    }
    if (html === null) return;  // view đã tự chuyển hướng
    app.innerHTML = layout(user, html);
    if (route === 'course') afterCourseRender(user, Number(id));
    if (route === 'exam') afterExamRender(user, Number(id));
    window.scrollTo(0, 0);
}

function viewError(msg) {
    return `<div class="row justify-content-center mt-5"><div class="col-md-6 card p-4 shadow text-center">
        <p class="lead">${esc(msg)}</p><a href="#/dashboard" class="btn btn-primary">‹ Về trang chính</a></div></div>`;
}

/* =====================================================================
 * ĐĂNG NHẬP
 * ===================================================================== */
function viewLogin() {
    return `
    <div class="login-wrap">
        <div class="row g-0">
            <div class="col-md-6 login-board">
                <div class="chalk-date">${todayLong()}</div>
                <div class="chalk-line"></div>
                <h1>Sổ lớp, điểm danh và kiểm tra trong một trang</h1>
                <p class="mt-3">Chạy ngay trên trình duyệt, không cần máy chủ hay Internet. Dữ liệu lưu trên chính máy này.</p>
                <div class="chalk-piece" aria-hidden="true"></div>
            </div>
            <div class="col-md-6 login-form">
                <h2>Đăng nhập</h2>
                <form data-form="login">
                    <div class="mb-3"><label class="form-label" for="login-user">Tên đăng nhập</label>
                        <input type="text" id="login-user" name="username" class="form-control" required autofocus autocomplete="username"></div>
                    <div class="mb-4"><label class="form-label" for="login-pass">Mật khẩu</label>
                        <input type="password" id="login-pass" name="password" class="form-control" required autocomplete="current-password"></div>
                    <button type="submit" class="btn btn-primary w-100 py-2">Đăng nhập</button>
                </form>
                <div class="demo-accounts small">
                    <div class="mb-2 text-muted">Dùng thử bằng tài khoản mẫu (mật khẩu <code>123</code>):</div>
                    <button type="button" data-demo="admin">Quản trị</button>
                    <button type="button" data-demo="gv1">Giáo viên</button>
                    <button type="button" data-demo="hs1">Học sinh</button>
                    <div class="text-muted mt-2">Mỗi tab là một phiên riêng: mở tab giáo viên và tab học sinh cạnh nhau để thử điểm danh và chat.</div>
                </div>
            </div>
        </div>
    </div>`;
}

/* =====================================================================
 * ADMIN
 * ===================================================================== */
function viewAdmin(user) {
    const teachers = DB.users.filter(u => u.role === 'teacher' && u.is_active);
    const users = [...DB.users].sort((a, b) => a.role.localeCompare(b.role) || a.username.localeCompare(b.username));
    const logs = [...DB.logs].reverse().slice(0, 30);
    return `
    ${pageTitle('Quản trị hệ thống', `${DB.users.length} tài khoản, ${DB.courses.length} lớp học`)}
    <div class="row g-4">
        <div class="col-md-6"><div class="card p-3 shadow-sm h-100">
            <h5>Tạo tài khoản</h5>
            <form data-form="addUser" class="row g-2 mb-3 border-bottom pb-3">
                <div class="col-md-4"><input name="username" class="form-control form-control-sm" placeholder="Username" required></div>
                <div class="col-md-4"><input name="password" class="form-control form-control-sm" placeholder="Mật khẩu" required></div>
                <div class="col-md-4"><select name="role" class="form-select form-select-sm">
                    <option value="student">Học sinh</option><option value="teacher">Giáo viên</option><option value="admin">Admin</option></select></div>
                <div class="col-md-8"><input name="full_name" class="form-control form-control-sm" placeholder="Họ và tên" required></div>
                <div class="col-md-4"><button class="btn btn-primary btn-sm w-100">Thêm tài khoản</button></div>
            </form>
            <form data-form="importUsers">
                <label class="form-label small fw-bold">Nhập từ Excel/CSV (cột: username, password, full_name, role):</label>
                <div class="input-group input-group-sm">
                    <input type="file" name="file" class="form-control" accept=".xlsx,.xls,.csv" required>
                    <button class="btn btn-success">Tải lên</button>
                </div>
                <small class="text-muted">role: <code>student</code>, <code>teacher</code> hoặc <code>admin</code>. Xem file mẫu <code>sample_users.csv</code>.</small>
            </form>
        </div></div>

        <div class="col-md-6"><div class="card p-3 shadow-sm h-100">
            <h5>Lớp học và lịch nhắc</h5>
            ${teachers.length ? `
            <form data-form="createCourse" class="row g-2 mb-3 border-bottom pb-3">
                <div class="col-md-6"><input name="name" class="form-control form-control-sm" placeholder="Tên môn học / Lớp" required></div>
                <div class="col-md-4"><select name="teacher_id" class="form-select form-select-sm">
                    ${teachers.map(t => `<option value="${t.id}">${esc(t.full_name)}</option>`).join('')}</select></div>
                <div class="col-md-2"><button class="btn btn-primary btn-sm w-100">Tạo</button></div>
            </form>` : `<div class="alert alert-warning py-2 small">Chưa có giáo viên nào. Hãy tạo tài khoản giáo viên trước.</div>`}
            ${eventForm()}
            <h6 class="fw-bold mt-3">Danh sách lớp (${DB.courses.length})</h6>
            <ul class="list-group list-group-flush small" style="max-height:150px;overflow-y:auto">
                ${DB.courses.map(c => `<li class="list-group-item d-flex justify-content-between">
                    <span>${esc(c.name)} <span class="text-muted">— ${esc(userName(c.teacher_id))}</span></span>
                    <a href="#/course/${c.id}">Xem</a></li>`).join('') || '<li class="list-group-item text-muted">Chưa có lớp nào.</li>'}
            </ul>
        </div></div>

        <div class="col-md-7"><div class="card p-3 shadow-sm">
            <h5>Người dùng (${users.length})</h5>
            <div class="table-responsive" style="max-height:360px">
            <table class="table table-sm table-hover align-middle">
                <thead><tr><th>Username</th><th>Họ tên</th><th>Vai trò</th><th>Trạng thái</th><th>Hành động</th></tr></thead>
                <tbody>${users.map(u => `<tr>
                    <td>${esc(u.username)}</td><td>${esc(u.full_name)}</td>
                    <td><span class="badge bg-secondary">${ROLE_LABELS[u.role] || esc(u.role)}</span></td>
                    <td>${u.is_active ? '<span class="text-success">Hoạt động</span>' : '<span class="text-danger">Đã khóa</span>'}</td>
                    <td class="text-nowrap">
                        ${u.username !== 'admin' && u.id !== user.id ? `<button class="btn btn-sm btn-outline-danger py-0 px-2" data-act="toggleUser" data-id="${u.id}">${u.is_active ? 'Khóa' : 'Mở'}</button>` : ''}
                        <button class="btn btn-sm btn-outline-secondary py-0 px-2" data-act="resetPassword" data-id="${u.id}">Đổi MK</button>
                    </td></tr>`).join('')}</tbody>
            </table></div>
        </div></div>

        <div class="col-md-5"><div class="card p-3 shadow-sm">
            <h5>Nhật ký hoạt động</h5>
            <ul class="list-group list-group-flush small" style="max-height:360px;overflow-y:auto">
                ${logs.map(l => `<li class="list-group-item"><b>${esc(l.user_name)}</b>: ${esc(l.action)}
                    <br><span class="text-muted">${esc(fmtDateTime(l.timestamp))}</span></li>`).join('')}
            </ul>
        </div></div>

        <div class="col-12"><div class="card p-3 shadow-sm border border-warning">
            <h5>Sao lưu và khôi phục dữ liệu</h5>
            <p class="small text-muted mb-2">Dữ liệu chỉ nằm trong trình duyệt này. Hãy sao lưu thường xuyên; xóa lịch sử/dữ liệu trình duyệt sẽ làm mất dữ liệu.
            File sao lưu cũng dùng để chuyển dữ liệu sang máy khác.</p>
            <div class="d-flex flex-wrap gap-2 align-items-center">
                <button class="btn btn-sm btn-primary" data-act="backup">Tải file sao lưu (.json)</button>
                <form data-form="restore" class="d-flex gap-2">
                    <input type="file" name="file" accept=".json" class="form-control form-control-sm" required>
                    <button class="btn btn-sm btn-outline-primary text-nowrap">Khôi phục</button>
                </form>
                <button class="btn btn-sm btn-outline-danger ms-auto" data-act="resetAll">Xóa hết và tạo lại dữ liệu mẫu</button>
            </div>
        </div></div>
    </div>`;
}

function eventForm() {
    return `
    <form data-form="addEvent" class="row g-2 mb-3">
        <div class="col-md-5"><input name="title" class="form-control form-control-sm" placeholder="Tên sự kiện nhắc nhở" required></div>
        <div class="col-md-4"><input type="date" name="event_date" class="form-control form-control-sm" required></div>
        <div class="col-md-3"><button class="btn btn-warning btn-sm w-100">Thêm lịch</button></div>
        <div class="col-12"><input name="description" class="form-control form-control-sm" placeholder="Ghi chú chi tiết sự kiện..."></div>
    </form>`;
}

function eventList() {
    const evs = [...DB.events].sort((a, b) => a.event_date.localeCompare(b.event_date));
    return `<ul class="list-group list-group-flush small">${evs.map(ev =>
        `<li class="list-group-item"><b>[${esc(ev.event_date)}] ${esc(ev.title)}</b>: ${esc(ev.description)}</li>`).join('')
        || '<li class="list-group-item text-muted">Không có sự kiện.</li>'}</ul>`;
}

/* =====================================================================
 * GIÁO VIÊN
 * ===================================================================== */
function viewTeacher(user) {
    const courses = managedCourses(user);
    const cids = new Set(courses.map(c => c.id));
    const exams = DB.exams.filter(e => cids.has(e.course_id));
    const eids = new Set(exams.map(e => e.id));
    const results = DB.results.filter(r => eids.has(r.exam_id)).sort((a, b) => b.submitted_at - a.submitted_at);
    const atts = DB.attendance.filter(a => cids.has(a.course_id)).slice(-100).reverse();
    const students = DB.users.filter(u => u.role === 'student' && u.is_active).sort((a, b) => a.full_name.localeCompare(b.full_name));
    const courseOpts = courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const sampleQs = `[
  {"id": 1, "level": "Dễ", "type": "mc", "question": "Thủ đô của Việt Nam là gì?", "options": ["Hà Nội", "TP.HCM", "Đà Nẵng", "Huế"], "answer": "Hà Nội"},
  {"id": 2, "level": "Khó", "type": "essay", "question": "Nêu cảm nghĩ của em về quê hương."}
]`;
    return `
    <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
        ${pageTitle(`Chào ${user.full_name}`, todayLong())}
        <div>
            <button class="btn btn-outline-success" data-act="exportAttendance">Xuất điểm danh (Excel)</button>
            <button class="btn btn-success" data-act="exportGrades">Xuất bảng điểm (Excel)</button>
        </div>
    </div>
    <div class="row g-4">
        <div class="col-md-6">
            <div class="card p-3 shadow-sm mb-4">
                <h5>Lớp học và mã PIN điểm danh</h5>
                <form data-form="createCourse" class="input-group input-group-sm mb-3">
                    <input name="name" class="form-control" placeholder="Tên lớp / môn học mới..." required>
                    <button class="btn btn-primary">Tạo lớp</button>
                </form>
                <ul class="list-group">
                ${courses.map(c => {
                    const active = pinActive(c);
                    return `<li class="list-group-item course-item">
                        <div><b>${esc(c.name)}</b>
                            <div class="pin-row">${active ? `<span id="pin-${c.id}" class="pin-board">${esc(c.pin)}</span>
                                <small class="text-muted text-nowrap">hết hạn lúc ${fmtTime(c.pin_created_at + PIN_VALID_MINUTES * 60000)}</small>`
                              : `<span id="pin-${c.id}" class="pin-off">Chưa mở điểm danh</span>`}</div>
                        </div>
                        <div class="text-nowrap">
                            <button class="btn btn-sm btn-outline-primary" data-act="genPin" data-id="${c.id}">Tạo PIN</button>
                            <button class="btn btn-sm btn-outline-secondary" data-act="closePin" data-id="${c.id}">Đóng</button>
                            <a href="#/course/${c.id}" class="btn btn-sm btn-info text-white">Tài liệu & chat</a>
                        </div></li>`;
                }).join('') || '<li class="list-group-item text-muted">Bạn chưa phụ trách lớp nào. Hãy tạo lớp mới ở trên.</li>'}
                </ul>
            </div>

            <div class="card p-3 shadow-sm mb-4">
                <h5>Điểm danh thủ công</h5>
                ${courses.length && students.length ? `
                <form data-form="manualAttendance" class="row g-2">
                    <div class="col-md-6"><select name="course_id" class="form-select form-select-sm" aria-label="Lớp">${courseOpts}</select></div>
                    <div class="col-md-6"><select name="student_id" aria-label="Học sinh" class="form-select form-select-sm">
                        ${students.map(s => `<option value="${s.id}">${esc(s.full_name)} (${esc(s.username)})</option>`).join('')}</select></div>
                    <div class="col-8"><select name="status" class="form-select form-select-sm" aria-label="Trạng thái">
                        ${ATTENDANCE_STATUSES.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
                    <div class="col-4"><button class="btn btn-success btn-sm w-100">Ghi nhận</button></div>
                </form>` : '<p class="text-muted small mb-0">Cần có ít nhất một lớp và một học sinh.</p>'}
                <h6 class="fw-bold mt-3">Điểm danh gần đây</h6>
                <div class="table-responsive" style="max-height:240px">
                <table class="table table-sm small">
                    <thead><tr><th>Thời gian</th><th>Lớp</th><th>Học sinh</th><th>Trạng thái</th></tr></thead>
                    <tbody>${atts.map(a => `<tr><td>${esc(a.date)}</td><td>${esc(courseName(a.course_id))}</td>
                        <td>${esc(userName(a.student_id))}</td><td>${statusBadge(a.status)}</td></tr>`).join('') || emptyRow(4, 'Chưa có dữ liệu điểm danh.')}</tbody>
                </table></div>
            </div>

            <div class="card p-3 shadow-sm">
                <h5>Lịch nhắc</h5>
                ${eventForm()}${eventList()}
            </div>
        </div>

        <div class="col-md-6">
            <div class="card p-3 shadow-sm mb-4">
                <h5>Tạo đề kiểm tra</h5>
                ${courses.length ? `
                <form data-form="createExam">
                    <div class="row g-2 mb-2">
                        <div class="col-md-6"><select name="course_id" class="form-select form-select-sm">${courseOpts}</select></div>
                        <div class="col-md-6"><input name="title" class="form-control form-control-sm" placeholder="Tên bài kiểm tra" required></div>
                        <div class="col-md-6"><input type="number" name="duration" class="form-control form-control-sm" value="30" min="1" max="600" required></div>
                        <div class="col-md-6"><input name="password" class="form-control form-control-sm" placeholder="Mật khẩu phòng thi (để trống nếu không)"></div>
                    </div>
                    <label class="small fw-bold">Danh sách câu hỏi (Định dạng JSON):</label>
                    <textarea name="questions_json" class="form-control form-control-sm font-monospace mb-1" rows="6" required>${esc(sampleQs)}</textarea>
                    <small class="text-muted d-block mb-2"><code>type</code>: <code>mc</code> (trắc nghiệm, cần <code>options</code> + <code>answer</code>) hoặc <code>essay</code> (tự luận). Điểm tự động chỉ tính phần trắc nghiệm.</small>
                    <button class="btn btn-danger btn-sm w-100">Phát hành đề</button>
                </form>` : '<p class="text-muted small mb-0">Hãy tạo lớp trước khi tạo đề thi.</p>'}
            </div>

            <div class="card p-3 shadow-sm mb-4">
                <h5>Đề đã phát hành</h5>
                <ul class="list-group list-group-flush small">
                ${exams.map(ex => `<li class="list-group-item d-flex justify-content-between align-items-center">
                    <span><b>${esc(ex.title)}</b> — ${esc(courseName(ex.course_id))} · ${ex.duration} phút${ex.password ? ' · có mật khẩu' : ''}</span>
                    <button class="btn btn-sm btn-outline-danger py-0" data-act="deleteExam" data-id="${ex.id}">Xóa</button></li>`).join('')
                    || '<li class="list-group-item text-muted">Chưa có đề thi.</li>'}
                </ul>
            </div>

            <div class="card p-3 shadow-sm">
                <h5>Bài đã nộp</h5>
                <div class="table-responsive" style="max-height:360px">
                <table class="table table-sm small align-middle">
                    <thead><tr><th>Học sinh</th><th>Bài thi</th><th>Điểm TN</th><th>Cảnh báo</th><th></th></tr></thead>
                    <tbody>${results.map(r => `<tr>
                        <td>${esc(userName(r.student_id))}</td><td>${esc(examTitle(r.exam_id))}</td>
                        <td>${scoreHtml(r.score)}</td>
                        <td><span class="badge bg-${r.warnings > 0 ? 'danger' : 'success'}">${r.warnings} lần</span>${r.late ? ' <span class="badge bg-warning text-dark">Trễ</span>' : ''}</td>
                        <td><a href="#/result/${r.id}">Xem bài</a></td></tr>`).join('') || emptyRow(5, 'Chưa có bài nộp.')}</tbody>
                </table></div>
            </div>
        </div>
    </div>`;
}

/* =====================================================================
 * HỌC SINH
 * ===================================================================== */
function viewStudent(user) {
    const results = DB.results.filter(r => r.student_id === user.id).sort((a, b) => b.submitted_at - a.submitted_at);
    const done = new Set(results.map(r => r.exam_id));
    const atts = DB.attendance.filter(a => a.student_id === user.id).reverse();
    return `
    ${pageTitle(`Chào ${user.full_name}`, todayLong())}
    <div class="row g-4">
        <div class="col-md-6">
            <div class="card p-3 shadow-sm mb-4">
                <h5>Điểm danh bằng mã PIN</h5>
                ${DB.courses.length ? `
                <form data-form="checkin" class="row g-2">
                    <div class="col-md-6"><select name="course_id" class="form-select">
                        ${DB.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
                    <div class="col-md-4"><input name="pin" class="form-control" placeholder="Nhập mã PIN 6 số"
                        inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></div>
                    <div class="col-md-2"><button class="btn btn-success w-100">Gửi</button></div>
                </form>` : '<p class="text-muted small mb-0">Chưa có lớp học nào.</p>'}
            </div>
            <div class="card p-3 shadow-sm mb-4">
                <h5>Lớp học của em</h5>
                <ul class="list-group">${DB.courses.map(c => `<li class="list-group-item d-flex justify-content-between align-items-center">
                    <span>${esc(c.name)}</span><a href="#/course/${c.id}" class="btn btn-sm btn-primary">Vào lớp</a></li>`).join('')}</ul>
            </div>
            <div class="card p-3 shadow-sm mb-4">
                <h5>Chuyên cần</h5>
                <div class="table-responsive" style="max-height:240px">
                <table class="table table-sm small"><thead><tr><th>Thời gian</th><th>Lớp</th><th>Trạng thái</th></tr></thead>
                <tbody>${atts.map(a => `<tr><td>${esc(a.date)}</td><td>${esc(courseName(a.course_id))}</td><td>${statusBadge(a.status)}</td></tr>`).join('')
                    || emptyRow(3, 'Chưa có dữ liệu điểm danh.')}</tbody></table></div>
            </div>
            <div class="card p-3 shadow-sm"><h5>Lịch nhắc</h5>${eventList()}</div>
        </div>
        <div class="col-md-6">
            <div class="card p-3 shadow-sm mb-4">
                <h5>Bài kiểm tra</h5>
                <ul class="list-group">${DB.exams.map(ex => `<li class="list-group-item d-flex justify-content-between align-items-center">
                    <div><b>${esc(ex.title)}</b>${ex.password ? ' <span class="badge bg-secondary">Có mật khẩu</span>' : ''}<br>
                    <small class="text-muted">${esc(courseName(ex.course_id))} · Thời gian: ${ex.duration} phút</small></div>
                    ${done.has(ex.id) ? '<span class="badge bg-success">Đã nộp</span>' : `<a href="#/exam/${ex.id}" class="btn btn-sm btn-danger">Vào thi</a>`}
                    </li>`).join('') || '<li class="list-group-item text-muted">Không có bài kiểm tra.</li>'}</ul>
            </div>
            <div class="card p-3 shadow-sm">
                <h5>Điểm của em</h5>
                <table class="table table-sm"><thead><tr><th>Bài kiểm tra</th><th>Điểm trắc nghiệm</th><th>Thời gian nộp</th></tr></thead>
                <tbody>${results.map(r => `<tr><td>${esc(examTitle(r.exam_id))}</td><td>${scoreHtml(r.score)}</td>
                    <td>${esc(fmtDateTime(r.submitted_at))}</td></tr>`).join('') || emptyRow(3, 'Chưa có bài làm.')}</tbody></table>
            </div>
        </div>
    </div>`;
}

/* =====================================================================
 * LỚP HỌC: TÀI LIỆU, TIẾN ĐỘ, CHAT
 * ===================================================================== */
function viewCourse(user, cid) {
    const course = byId('courses', cid);
    if (!course) return viewError('Không tìm thấy lớp học.');
    const manage = canManageCourse(user, course);
    const mats = DB.materials.filter(m => m.course_id === cid);
    const totalStudents = DB.users.filter(u => u.role === 'student' && u.is_active).length;
    return `
    <div class="mb-3">
        <a href="#/dashboard" class="btn btn-sm btn-outline-secondary">‹ Về trang chính</a>
        <h4 class="d-inline-block ms-2 mb-0 align-middle">${esc(course.name)}</h4>
    </div>
    <div class="row g-4">
        <div class="col-md-6"><div class="card p-3 shadow-sm">
            <h5>Tài liệu và tiến độ học</h5>
            ${manage ? `
            <form data-form="uploadMaterial" data-id="${cid}" class="mb-3 border-bottom pb-3">
                <input name="title" class="form-control form-control-sm mb-2" placeholder="Tên bài học / tài liệu" required>
                <input type="file" name="file" class="form-control form-control-sm mb-2" required>
                <button class="btn btn-primary btn-sm">Tải tài liệu lên</button>
                <small class="text-muted ms-2">Tối đa 50MB / file</small>
            </form>` : ''}
            <ul class="list-group">
            ${mats.map(m => {
                const doneIds = m.completed || [];
                return `<li class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                    ${user.role === 'student' ? `<input type="checkbox" class="form-check-input me-2" id="mat-${m.id}" data-act="toggleProgress" data-id="${m.id}" ${doneIds.includes(user.id) ? 'checked' : ''}>` : ''}
                    <a href="#" data-act="openFile" data-id="${m.id}" class="fw-bold text-decoration-none">${esc(m.title)}</a>
                    <br><small class="text-muted">${esc(m.original_name)} · ${fmtSize(m.size || 0)}</small>
                </div>
                <div class="text-nowrap">
                ${user.role === 'student'
                    ? `<label for="mat-${m.id}" class="badge bg-info text-dark">Đánh dấu đã học</label>`
                    : `<span class="badge bg-secondary">${doneIds.length}/${totalStudents} HS đã học</span>`}
                ${manage ? `<button class="btn btn-sm btn-outline-danger py-0 ms-1" data-act="deleteMaterial" data-id="${m.id}">Xóa</button>` : ''}
                </div></li>`;
            }).join('') || '<li class="list-group-item text-muted">Chưa có tài liệu.</li>'}
            </ul>
        </div></div>
        <div class="col-md-6"><div class="card p-3 shadow-sm">
            <h5>Trò chuyện cả lớp</h5>
            <small class="text-muted mb-2">Tin nhắn được đồng bộ giữa các tab trên cùng trình duyệt này.</small>
            <div id="chat-box" class="border rounded p-3 mb-2 bg-light" style="height:320px;overflow-y:scroll"></div>
            <form data-form="chat" data-id="${cid}" class="input-group">
                <input name="msg" id="msg-input" class="form-control" maxlength="1000" placeholder="Nhập tin nhắn thảo luận..." autocomplete="off">
                <button class="btn btn-success">Gửi</button>
            </form>
        </div></div>
    </div>`;
}

function renderChat(cid) {
    const box = document.getElementById('chat-box');
    if (!box) return;
    const msgs = DB.chats[cid] || [];
    const me = currentUser();
    box.replaceChildren(...msgs.map(m => {
        // Dùng textContent để chống chèn mã độc (XSS)
        const line = document.createElement('div');
        line.className = 'mb-1' + (me && m.user === me.full_name ? ' mine' : '');
        const t = document.createElement('small'); t.className = 'text-muted me-1'; t.textContent = `[${fmtTime(m.time)}]`;
        const n = document.createElement('b'); n.textContent = `${m.user}: `;
        line.append(t, n, document.createTextNode(m.msg));
        return line;
    }));
    box.scrollTop = box.scrollHeight;
}
function afterCourseRender(user, cid) { renderChat(cid); }

/* =====================================================================
 * PHÒNG THI & CHỐNG GIAN LẬN
 * ===================================================================== */
function examKey(uid, eid) { return `${uid}-${eid}`; }

/** Xáo trộn ổn định theo học sinh + đề (tải lại trang không đổi thứ tự) */
function seededShuffle(arr, seedStr) {
    let seed = parseInt(sha256(seedStr).slice(0, 8), 16);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

function viewExam(user, eid) {
    if (user.role !== 'student') return viewError('Chỉ học sinh mới vào phòng thi.');
    const exam = byId('exams', eid);
    if (!exam) return viewError('Không tìm thấy bài thi.');
    if (DB.results.some(r => r.exam_id === eid && r.student_id === user.id)) {
        flash('Bạn đã nộp bài thi này rồi.', 'warning');
        go('#/dashboard');
        return null;
    }
    const started = DB.examStarts[examKey(user.id, eid)];
    if (!started && exam.password) {
        return `
        <div class="row justify-content-center mt-5"><div class="col-md-4 card p-4 shadow">
            <h5 class="fw-bold text-center mb-3">Phòng thi có mật khẩu</h5>
            <p class="text-center text-muted">${esc(exam.title)}</p>
            <div id="pw-error"></div>
            <form data-form="examPassword" data-id="${eid}">
                <input type="password" name="exam_password" class="form-control mb-3" placeholder="Nhập mật khẩu phòng thi..." required autofocus>
                <button class="btn btn-danger w-100">Xác nhận vào thi</button>
            </form>
            <a href="#/dashboard" class="btn btn-link mt-2">‹ Quay lại</a>
        </div></div>`;
    }
    if (!started) mutate(() => { DB.examStarts[examKey(user.id, eid)] = Date.now(); });
    const questions = seededShuffle(exam.questions, `${user.id}-${eid}`);
    return `
    <div class="row">
        <div class="col-md-9"><div class="card p-4 shadow">
            <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h4 class="mb-0">${esc(exam.title)}</h4>
                <div>
                    <span id="warning-badge" class="badge bg-danger me-2">Cảnh báo gian lận: 0/3</span>
                    <span id="timer" class="badge bg-dark fs-6">Thời gian: --:--</span>
                </div>
            </div>
            <button type="button" id="start-proctor" class="btn btn-warning mb-3 fw-bold" data-act="startProctor">
                Bật toàn màn hình và webcam giám sát trước khi làm bài</button>
            <form id="exam-form" onsubmit="return false;">
                ${questions.map((q, qi) => `
                <div class="mb-3 p-3 bg-white exam-question">
                    <p class="fw-semibold"><span class="q-no">Câu ${qi + 1}.</span> ${esc(q.question)}${q.level ? `<span class="badge bg-secondary q-level">${esc(q.level)}</span>` : ''}</p>
                    ${q.type === 'mc'
                        ? q.options.map((opt, oi) => `<div class="form-check">
                            <input class="form-check-input" type="radio" name="${esc(q.id)}" value="${esc(opt)}" id="q${qi}_${oi}">
                            <label class="form-check-label" for="q${qi}_${oi}">${esc(opt)}</label></div>`).join('')
                        : `<textarea class="form-control" name="${esc(q.id)}" rows="3" placeholder="Nhập câu trả lời tự luận..."></textarea>`}
                </div>`).join('')}
                <button type="button" id="submit-btn" class="btn btn-success btn-lg w-100 fw-bold" data-act="submitExam">Nộp bài</button>
            </form>
        </div></div>
        <div class="col-md-3"><div class="card p-3 text-center shadow sticky-top" style="top:20px">
            <h6 class="fw-bold">Camera giám sát</h6>
            <video id="proctor-cam" autoplay playsinline muted class="w-100 rounded bg-dark" style="height:180px;object-fit:cover"></video>
            <div id="cam-msg"></div>
            <small class="text-muted mt-2">Bài làm được tự động lưu khi bạn chọn đáp án, tải lại trang không mất bài.</small>
        </div></div>
    </div>`;
}

const MAX_WARNINGS = 3;
let examState = null;

function afterExamRender(user, eid) {
    const exam = byId('exams', eid);
    const form = document.getElementById('exam-form');
    if (!exam || !form) return;
    const started = DB.examStarts[examKey(user.id, eid)];
    const deadline = started + exam.duration * 60000;
    const draftKey = `exam_draft_${user.id}_${eid}`;
    examState = { user, exam, warnings: 0, submitted: false, proctor: false, lastWarn: 0, draftKey, stream: null };

    // Khôi phục bài làm nháp
    try {
        const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
        if (saved) {
            examState.warnings = saved.__warnings || 0;
            for (const el of form.elements) {
                if (!(el.name in saved)) continue;
                if (el.type === 'radio') el.checked = el.value === saved[el.name];
                else el.value = saved[el.name];
            }
        }
    } catch (e) { /* bỏ qua */ }
    updateWarningBadge();

    const autosave = () => {
        const answers = { __warnings: examState.warnings };
        new FormData(form).forEach((v, k) => { answers[k] = v; });
        try { localStorage.setItem(draftKey, JSON.stringify(answers)); } catch (e) { /* đầy */ }
    };
    examState.autosave = autosave;
    form.addEventListener('input', autosave);
    form.addEventListener('change', autosave);

    const tick = () => {
        const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        const el = document.getElementById('timer');
        if (el) { el.innerText = `Thời gian: ${Math.floor(left / 60)}:${pad(left % 60)}`; el.classList.toggle('urgent', left <= 60); }
        if (left <= 0) { clearInterval(timer); submitExam('Đã hết giờ làm bài!'); }
    };
    const timer = setInterval(tick, 1000);
    tick();

    const onVisibility = () => { if (document.hidden) cheatWarning('Bạn vừa rời khỏi tab làm bài thi!'); };
    const onFullscreen = () => {
        if (!document.fullscreenElement) {
            cheatWarning('Bạn đã thoát chế độ toàn màn hình!');
            const btn = document.getElementById('start-proctor');
            if (btn && !examState.submitted) btn.classList.remove('d-none');
        }
    };
    const block = e => e.preventDefault();
    const blockPaste = e => { if (e.target && e.target.tagName === 'TEXTAREA') e.preventDefault(); };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    document.addEventListener('paste', blockPaste);

    pageCleanup = () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('fullscreenchange', onFullscreen);
        document.removeEventListener('contextmenu', block);
        document.removeEventListener('copy', block);
        document.removeEventListener('paste', blockPaste);
        if (examState && examState.stream) examState.stream.getTracks().forEach(t => t.stop());
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        examState = null;
    };
}

function updateWarningBadge() {
    const b = document.getElementById('warning-badge');
    if (b && examState) b.innerText = `Cảnh báo gian lận: ${examState.warnings}/${MAX_WARNINGS}`;
}

function cheatWarning(reason) {
    const s = examState;
    if (!s || !s.proctor || s.submitted) return;
    const now = Date.now();
    if (now - s.lastWarn < 1500) return;  // Alt+Tab bắn 2 sự kiện -> tính 1 lần
    s.lastWarn = now;
    s.warnings++;
    updateWarningBadge();
    s.autosave();
    if (s.warnings >= MAX_WARNINGS) { submitExam(`Vi phạm ${MAX_WARNINGS} lần - hệ thống tự động nộp bài.`); return; }
    alert(`CẢNH BÁO (${s.warnings}/${MAX_WARNINGS}): ${reason}\nNếu vi phạm đủ ${MAX_WARNINGS} lần, hệ thống sẽ tự động nộp bài!`);
}

async function startProctor() {
    const s = examState;
    if (!s) return;
    try {
        if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch (e) { console.log(e); }
    s.proctor = true;
    const btn = document.getElementById('start-proctor');
    if (btn && document.fullscreenElement) btn.classList.add('d-none');
    if (s.stream) return;
    try {
        s.stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (examState === s) document.getElementById('proctor-cam').srcObject = s.stream;
        else s.stream.getTracks().forEach(t => t.stop());
    } catch (e) {
        const m = document.getElementById('cam-msg');
        if (m) m.innerHTML = '<div class="small text-danger mt-1">Không bật được webcam (chưa cấp quyền hoặc không có camera).</div>';
    }
}

function submitExam(reason) {
    const s = examState;
    if (!s || s.submitted) return;
    s.submitted = true;
    const form = document.getElementById('exam-form');
    const answers = {};
    new FormData(form).forEach((v, k) => { answers[k] = String(v).slice(0, 5000); });
    const { exam, user } = s;
    const result = mutate(() => {
        if (DB.results.some(r => r.exam_id === exam.id && r.student_id === user.id)) return null;
        const started = DB.examStarts[examKey(user.id, exam.id)] || Date.now();
        const late = Date.now() - started > exam.duration * 60000 + EXAM_GRACE_SECONDS * 1000;
        const mc = exam.questions.filter(q => q.type === 'mc');
        const correct = mc.filter(q => answers[String(q.id)] === q.answer).length;
        const score = mc.length ? Math.round(correct / mc.length * 1000) / 100 : 0;
        const r = insert('results', { exam_id: exam.id, student_id: user.id, score, answers, warnings: s.warnings, late, submitted_at: Date.now() });
        delete DB.examStarts[examKey(user.id, exam.id)];
        logAction(user.full_name, `Nộp bài '${exam.title}' - ${score}/10 - ${s.warnings} cảnh báo${late ? ' - NỘP TRỄ' : ''}`);
        return r;
    });
    localStorage.removeItem(s.draftKey);
    if (result) flash(`${reason ? reason + ' ' : ''}Đã nộp bài thành công! Điểm trắc nghiệm của bạn: ${result.score}/10`);
    else flash('Bài thi này đã được nộp trước đó.', 'warning');
    go('#/dashboard');
}

/* ---------- Xem chi tiết bài làm (giáo viên) ---------- */
function viewResult(user, rid) {
    const r = byId('results', rid);
    const exam = r && byId('exams', r.exam_id);
    const course = exam && byId('courses', exam.course_id);
    if (!r || !exam) return viewError('Không tìm thấy bài làm.');
    if (!canManageCourse(user, course)) return viewError('Bạn không có quyền xem bài làm này.');
    return `
    <a href="#/dashboard" class="btn btn-sm btn-outline-secondary mb-3">‹ Về trang chính</a>
    <div class="card p-4 shadow-sm">
        <h4 class="fw-bold">${esc(exam.title)}</h4>
        <p class="mb-1">Học sinh: <b>${esc(userName(r.student_id))}</b></p>
        <p class="mb-1">Điểm trắc nghiệm: ${scoreHtml(r.score)} <span class="mx-2"></span>
           Cảnh báo gian lận: <span class="badge bg-${r.warnings > 0 ? 'danger' : 'success'}">${r.warnings} lần</span>
           ${r.late ? '<span class="badge bg-warning text-dark">Nộp trễ</span>' : ''}</p>
        <p class="text-muted small">Nộp lúc ${esc(fmtDateTime(r.submitted_at))}</p><hr>
        ${exam.questions.map((q, i) => {
            const ans = r.answers[String(q.id)] || '';
            return `<div class="mb-3 p-3 border rounded"><p class="fw-bold mb-1">Câu ${i + 1}: ${esc(q.question)}</p>
            ${q.type === 'mc'
                ? `<p class="mb-0">Trả lời: <b class="${ans === q.answer ? 'text-success' : 'text-danger'}">${esc(ans || '(bỏ trống)')}</b>
                   ${ans !== q.answer ? ` · Đáp án đúng: <b>${esc(q.answer)}</b>` : ''}</p>`
                : `<div class="bg-light p-2 rounded" style="white-space:pre-wrap">${esc(ans || '(bỏ trống)')}</div>`}</div>`;
        }).join('')}
    </div>`;
}

/* =====================================================================
 * XỬ LÝ FORM
 * ===================================================================== */
const forms = {
    login(f, fd) {
        const u = DB.users.find(x => x.username === String(fd.get('username')).trim());
        if (u && u.is_active && checkPassword(u, fd.get('password'))) {
            setSession(u.id);
            mutate(() => logAction(u.full_name, 'Đăng nhập hệ thống'));
            go('#/dashboard');
        } else {
            flash('Sai tài khoản hoặc tài khoản đã bị khóa!', 'danger');
            render();
        }
    },

    addUser(f, fd, me) {
        const username = String(fd.get('username')).trim(), full_name = String(fd.get('full_name')).trim();
        const password = String(fd.get('password')), role = fd.get('role');
        if (!username || !password || !full_name || !ROLES.includes(role)) flash('Vui lòng nhập đầy đủ thông tin hợp lệ.', 'danger');
        else if (DB.users.some(u => u.username === username)) flash(`Tên đăng nhập "${username}" đã tồn tại.`, 'warning');
        else {
            mutate(() => {
                insert('users', { username, password: hashPassword(password), full_name, role, is_active: true });
                logAction(me.full_name, `Tạo tài khoản ${username}`);
            });
            flash(`Đã tạo tài khoản ${username}.`);
        }
        render();
    },

    async importUsers(f, fd, me) {
        const file = fd.get('file');
        let rows;
        try {
            const name = file.name.toLowerCase();
            const wb = name.endsWith('.csv')
                ? XLSX.read(await file.text(), { type: 'string', raw: true })     // raw: giữ số 0 đầu (VD mật khẩu 0123)
                : XLSX.read(await file.arrayBuffer(), { type: 'array' });
            rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
        } catch (e) {
            flash('Không đọc được file: ' + e.message, 'danger'); render(); return;
        }
        const norm = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).replace(/^﻿/, '').trim().toLowerCase(), String(v).trim()])));
        const missing = ['username', 'password', 'full_name', 'role'].filter(c => !norm.length || !(c in norm[0]));
        if (missing.length) { flash('File thiếu cột: ' + missing.join(', '), 'danger'); render(); return; }
        let added = 0, skipped = 0;
        mutate(() => {
            const existing = new Set(DB.users.map(u => u.username));
            for (const r of norm) {
                const role = r.role.toLowerCase();
                if (!r.username || !r.password || !r.full_name || !ROLES.includes(role) || existing.has(r.username)) { skipped++; continue; }
                insert('users', { username: r.username, password: hashPassword(r.password), full_name: r.full_name, role, is_active: true });
                existing.add(r.username); added++;
            }
            logAction(me.full_name, `Nhập ${added} người dùng từ file ${file.name}`);
        });
        flash(`Đã thêm ${added} tài khoản, bỏ qua ${skipped} dòng (trùng hoặc thiếu dữ liệu).`);
        render();
    },

    createCourse(f, fd, me) {
        const name = String(fd.get('name')).trim();
        let tid = me.id;
        if (me.role === 'admin') {
            tid = Number(fd.get('teacher_id'));
            const t = byId('users', tid);
            if (!t || t.role !== 'teacher') { flash('Vui lòng chọn giáo viên phụ trách hợp lệ.', 'danger'); render(); return; }
        }
        if (!name) { flash('Tên lớp không được để trống.', 'danger'); render(); return; }
        mutate(() => { insert('courses', { name, teacher_id: tid, pin: '', pin_created_at: null }); logAction(me.full_name, `Tạo môn học/lớp: ${name}`); });
        flash(`Đã tạo lớp "${name}".`);
        render();
    },

    addEvent(f, fd, me) {
        const title = String(fd.get('title')).trim(), event_date = String(fd.get('event_date'));
        if (!title || !event_date) { flash('Vui lòng nhập tên và ngày sự kiện.', 'danger'); render(); return; }
        mutate(() => { insert('events', { title, event_date, description: String(fd.get('description') || '').trim() }); logAction(me.full_name, `Thêm sự kiện lịch: ${title}`); });
        render();
    },

    manualAttendance(f, fd, me) {
        const course = byId('courses', fd.get('course_id'));
        const student = byId('users', fd.get('student_id'));
        const status = fd.get('status');
        if (!canManageCourse(me, course) || !student || student.role !== 'student' || !ATTENDANCE_STATUSES.includes(status)) {
            flash('Dữ liệu điểm danh không hợp lệ.', 'danger'); render(); return;
        }
        mutate(() => {
            const today = todayStr();
            const att = DB.attendance.find(a => a.course_id === course.id && a.student_id === student.id && a.date.startsWith(today));
            if (att) att.status = status;
            else insert('attendance', { course_id: course.id, student_id: student.id, date: fmtDateTime(Date.now()), status });
            logAction(me.full_name, `Điểm danh thủ công: ${student.full_name} - ${status} - ${course.name}`);
        });
        flash(`Đã ghi nhận: ${student.full_name} - ${status}.`);
        render();
    },

    checkin(f, fd, me) {
        const course = byId('courses', fd.get('course_id'));
        const pin = String(fd.get('pin')).trim();
        if (!course || !pin || course.pin !== pin || !pinActive(course)) {
            flash('Mã PIN không đúng, đã hết hạn hoặc lớp chưa mở điểm danh!', 'danger'); render(); return;
        }
        const today = todayStr();
        if (DB.attendance.some(a => a.course_id === course.id && a.student_id === me.id && a.date.startsWith(today))) {
            flash('Bạn đã điểm danh lớp này hôm nay rồi.', 'warning'); render(); return;
        }
        mutate(() => insert('attendance', { course_id: course.id, student_id: me.id, date: fmtDateTime(Date.now()), status: 'Có mặt' }));
        flash(`Điểm danh thành công lớp ${course.name}!`);
        render();
    },

    createExam(f, fd, me) {
        const course = byId('courses', fd.get('course_id'));
        if (!canManageCourse(me, course)) { flash('Bạn không quản lý lớp này.', 'danger'); render(); return; }
        const [questions, err] = validateQuestions(String(fd.get('questions_json')));
        const duration = parseInt(fd.get('duration'), 10);
        const title = String(fd.get('title')).trim();
        if (err || !title || !(duration > 0 && duration <= 600)) {
            flash(err || 'Tên đề và thời gian (1–600 phút) là bắt buộc.', 'danger');
            const keep = String(fd.get('questions_json'));
            render();
            const ta = document.querySelector('[name=questions_json]');
            if (ta) ta.value = keep;  // Giữ lại nội dung để giáo viên sửa
            return;
        }
        mutate(() => {
            insert('exams', { course_id: course.id, title, duration, password: String(fd.get('password') || '').trim(), questions });
            logAction(me.full_name, `Tạo đề thi: ${title}`);
        });
        flash(`Đã phát hành đề "${title}" (${questions.length} câu).`);
        render();
    },

    examPassword(f, fd, me) {
        const exam = byId('exams', f.dataset.id);
        if (exam && fd.get('exam_password') === exam.password) {
            mutate(() => { DB.examStarts[examKey(me.id, exam.id)] = Date.now(); });
            render();
        } else {
            document.getElementById('pw-error').innerHTML = '<div class="alert alert-danger">Mật khẩu phòng thi không chính xác!</div>';
        }
    },

    async uploadMaterial(f, fd, me) {
        const cid = Number(f.dataset.id);
        const course = byId('courses', cid);
        const file = fd.get('file'), title = String(fd.get('title')).trim();
        if (!canManageCourse(me, course)) return;
        if (!file || !file.name || !title) { flash('Vui lòng nhập tên tài liệu và chọn file.', 'danger'); render(); return; }
        if (file.size > 50 * 1024 * 1024) { flash('File quá lớn (tối đa 50MB).', 'danger'); render(); return; }
        const fileKey = 'f_' + randomHex(12);
        try {
            await FileStore.put(fileKey, file);
        } catch (e) { flash('Không lưu được file: ' + e.message, 'danger'); render(); return; }
        mutate(() => {
            insert('materials', { course_id: cid, title, file_key: fileKey, original_name: file.name, mime: file.type, size: file.size, completed: [] });
            logAction(me.full_name, `Tải tài liệu '${title}' cho lớp ${course.name}`);
        });
        flash('Đã tải tài liệu lên.');
        render();
    },

    chat(f, fd, me) {
        const cid = Number(f.dataset.id);
        const msg = String(fd.get('msg') || '').trim().slice(0, 1000);
        if (!msg || !byId('courses', cid)) return;
        mutate(() => {
            const list = DB.chats[cid] = DB.chats[cid] || [];
            list.push({ user: me.full_name, msg, time: Date.now() });
            if (list.length > 300) DB.chats[cid] = list.slice(-300);
        });
        f.reset();
        renderChat(cid);
        document.getElementById('msg-input').focus();
    },

    async restore(f, fd, me) {
        let data;
        try { data = JSON.parse(await fd.get('file').text()); } catch (e) { flash('File sao lưu không hợp lệ.', 'danger'); render(); return; }
        if (!data || !data.db || data.db.version !== 1 || !Array.isArray(data.db.users)) { flash('File sao lưu không đúng định dạng.', 'danger'); render(); return; }
        if (!confirm('Khôi phục sẽ THAY THẾ toàn bộ dữ liệu hiện tại. Tiếp tục?')) return;
        await FileStore.clear();
        for (const [key, dataUrl] of Object.entries(data.files || {})) {
            await FileStore.put(key, await (await fetch(dataUrl)).blob());
        }
        DB = data.db;
        saveDB();
        clearSession();
        flash('Đã khôi phục dữ liệu. Vui lòng đăng nhập lại.');
        go('#/login');
    }
};

/* =====================================================================
 * XỬ LÝ NÚT BẤM
 * ===================================================================== */
const actions = {
    logout() { clearSession(); go('#/login'); },

    toggleUser(el, me) {
        if (me.role !== 'admin') return;
        mutate(() => {
            const u = byId('users', el.dataset.id);
            if (!u || u.username === 'admin' || u.id === me.id) return;
            u.is_active = !u.is_active;
            logAction(me.full_name, `${u.is_active ? 'Mở khóa' : 'Khóa'} tài khoản ${u.username}`);
        });
        render();
    },

    resetPassword(el, me) {
        if (me.role !== 'admin') return;
        const u = byId('users', el.dataset.id);
        const pw = prompt(`Mật khẩu mới cho ${u.username}:`);
        if (!pw) return;
        if (pw.length < 3) { flash('Mật khẩu mới phải có ít nhất 3 ký tự.', 'danger'); render(); return; }
        mutate(() => { byId('users', u.id).password = hashPassword(pw); logAction(me.full_name, `Đặt lại mật khẩu cho ${u.username}`); });
        flash(`Đã đặt lại mật khẩu cho ${u.username}.`);
        render();
    },

    genPin(el, me) {
        const c = byId('courses', el.dataset.id);
        if (!canManageCourse(me, c)) return;
        const arr = new Uint32Array(1); crypto.getRandomValues(arr);
        const pin = String(arr[0] % 1000000).padStart(6, '0');
        mutate(() => { const cc = byId('courses', c.id); cc.pin = pin; cc.pin_created_at = Date.now(); logAction(me.full_name, `Mở điểm danh PIN lớp ${c.name}`); });
        render();
    },

    closePin(el, me) {
        const c = byId('courses', el.dataset.id);
        if (!canManageCourse(me, c)) return;
        mutate(() => { const cc = byId('courses', c.id); cc.pin = ''; cc.pin_created_at = null; });
        render();
    },

    deleteExam(el, me) {
        const ex = byId('exams', el.dataset.id);
        if (!ex || !canManageCourse(me, byId('courses', ex.course_id))) return;
        if (!confirm('Xóa đề thi này và toàn bộ kết quả?')) return;
        mutate(() => {
            DB.exams = DB.exams.filter(e => e.id !== ex.id);
            DB.results = DB.results.filter(r => r.exam_id !== ex.id);
            logAction(me.full_name, `Xóa đề thi: ${ex.title}`);
        });
        flash('Đã xóa đề thi.');
        render();
    },

    async deleteMaterial(el, me) {
        const m = byId('materials', el.dataset.id);
        if (!m || !canManageCourse(me, byId('courses', m.course_id))) return;
        if (!confirm(`Xóa tài liệu "${m.title}"?`)) return;
        await FileStore.del(m.file_key).catch(() => {});
        mutate(() => { DB.materials = DB.materials.filter(x => x.id !== m.id); });
        render();
    },

    async openFile(el) {
        const m = byId('materials', el.dataset.id);
        const blob = m && await FileStore.get(m.file_key).catch(() => null);
        if (!blob) { alert('Không tìm thấy file trong trình duyệt này (có thể dữ liệu đã bị xóa).'); return; }
        downloadBlob(blob, m.original_name);
    },

    toggleProgress(el, me) {
        mutate(() => {
            const m = byId('materials', el.dataset.id);
            if (!m) return;
            m.completed = m.completed || [];
            if (m.completed.includes(me.id)) m.completed = m.completed.filter(x => x !== me.id);
            else m.completed.push(me.id);
            el.checked = m.completed.includes(me.id);
        });
    },

    startProctor() { startProctor(); },
    submitExam() { if (confirm('Bạn chắc chắn muốn nộp bài?')) submitExam(''); },

    exportGrades(el, me) {
        const cids = new Set(managedCourses(me).map(c => c.id));
        const eids = new Set(DB.exams.filter(e => cids.has(e.course_id)).map(e => e.id));
        const rows = DB.results.filter(r => eids.has(r.exam_id)).map(r => ({
            'Học sinh': userName(r.student_id), 'Bài kiểm tra': examTitle(r.exam_id), 'Điểm số': r.score,
            'Số lần cảnh báo gian lận': r.warnings, 'Nộp trễ': r.late ? 'Có' : '', 'Thời gian nộp': fmtDateTime(r.submitted_at)
        }));
        exportExcel(rows.length ? rows : [{ 'Học sinh': '', 'Bài kiểm tra': '', 'Điểm số': '' }], 'BangDiem', 'Bang_Diem_Lop_Hoc.xlsx');
    },

    exportAttendance(el, me) {
        const cids = new Set(managedCourses(me).map(c => c.id));
        const rows = DB.attendance.filter(a => cids.has(a.course_id)).map(a => ({
            'Lớp': courseName(a.course_id), 'Học sinh': userName(a.student_id), 'Thời gian': a.date, 'Trạng thái': a.status
        }));
        exportExcel(rows.length ? rows : [{ 'Lớp': '', 'Học sinh': '', 'Thời gian': '', 'Trạng thái': '' }], 'DiemDanh', 'Diem_Danh_Lop_Hoc.xlsx');
    },

    async backup(el, me) {
        if (me.role !== 'admin') return;
        const files = {};
        for (const key of await FileStore.keys()) {
            const blob = await FileStore.get(key);
            files[key] = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
        }
        const payload = { app: 'School_Management_Offline', exported_at: new Date().toISOString(), db: DB, files };
        downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `lms_backup_${todayStr()}.json`);
    },

    async resetAll(el, me) {
        if (me.role !== 'admin') return;
        if (!confirm('XÓA TOÀN BỘ dữ liệu và tạo lại dữ liệu mẫu? Hãy sao lưu trước!')) return;
        localStorage.removeItem(DB_KEY);
        await FileStore.clear().catch(() => {});
        Object.keys(localStorage).filter(k => k.startsWith('exam_draft_')).forEach(k => localStorage.removeItem(k));
        clearSession();
        loadDB();
        flash('Đã tạo lại dữ liệu mẫu.');
        go('#/login');
    }
};

/* ---------- Gắn sự kiện chung ---------- */
document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    loadDB();
    const me = currentUser();
    const name = f.dataset.form;
    if (name !== 'login' && !me) { go('#/login'); return; }
    Promise.resolve(forms[name](f, new FormData(f), me)).catch(err => { console.error(err); alert('Lỗi: ' + err.message); });
});

document.addEventListener('click', e => {
    const demo = e.target.closest('[data-demo]');
    if (demo) {  // Điền nhanh tài khoản mẫu ở trang đăng nhập
        document.getElementById('login-user').value = demo.dataset.demo;
        document.getElementById('login-pass').value = '123';
        document.querySelector('form[data-form=login]').requestSubmit();
        return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'A') e.preventDefault();
    loadDB();
    const me = currentUser();
    if (!me) { go('#/login'); return; }
    Promise.resolve(actions[el.dataset.act](el, me)).catch(err => { console.error(err); alert('Lỗi: ' + err.message); });
});

/* Đồng bộ giữa các tab: chat, điểm danh, PIN cập nhật ngay */
window.addEventListener('storage', e => {
    if (e.key !== DB_KEY) return;
    loadDB();
    const [route, id] = location.hash.replace(/^#\/?/, '').split('/');
    if (route === 'course') { renderChat(Number(id)); return; }
    if (route === 'exam') return;  // Không làm gián đoạn bài thi
    const active = document.activeElement;
    const typing = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && active.type !== 'submit';
    if (!typing && currentUser()) render();
});

window.addEventListener('hashchange', render);
render();

/* Cài đặt dùng offline (PWA) khi chạy qua http(s), VD GitHub Pages */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
