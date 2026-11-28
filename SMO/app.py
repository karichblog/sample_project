import os
import io
import json
import uuid
import random
import secrets
import string
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, render_template, request, redirect, url_for, session, jsonify,
                   send_from_directory, send_file, flash, abort)
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, join_room, send, rooms
from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import pandas as pd

# ================= CẤU HÌNH =================

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
INSTANCE_DIR = os.path.join(BASE_DIR, 'instance')
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
os.makedirs(INSTANCE_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)


def load_secret_key():
    """Ưu tiên biến môi trường SECRET_KEY; nếu không có thì tự sinh và lưu vào instance/ (không đẩy lên GitHub)."""
    env_key = os.environ.get('SECRET_KEY')
    if env_key:
        return env_key
    key_file = os.path.join(INSTANCE_DIR, 'secret_key')
    if os.path.exists(key_file):
        with open(key_file) as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(key_file, 'w') as f:
        f.write(key)
    return key


app = Flask(__name__, instance_path=INSTANCE_DIR)
app.config['SECRET_KEY'] = load_secret_key()
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL', 'sqlite:///' + os.path.join(INSTANCE_DIR, 'database.db'))
app.config['UPLOAD_FOLDER'] = UPLOAD_DIR
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # Giới hạn file tải lên 50MB

PIN_VALID_MINUTES = 15          # Mã PIN điểm danh hết hạn sau 15 phút
EXAM_GRACE_SECONDS = 120        # Cho phép nộp trễ tối đa 2 phút (mạng chậm)
ROLES = ('admin', 'teacher', 'student')
ATTENDANCE_STATUSES = ('Có mặt', 'Đi muộn', 'Vắng có phép', 'Vắng không phép')

db = SQLAlchemy(app)
socketio = SocketIO(app)  # Chỉ chấp nhận kết nối cùng origin (an toàn hơn "*")

# ================= CƠ SỞ DỮ LIỆU (MODELS) =================


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)  # Lưu dạng băm (hash)
    full_name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # 'admin', 'teacher', 'student'
    is_active = db.Column(db.Boolean, default=True)

    def set_password(self, raw):
        self.password = generate_password_hash(raw)

    def check_password(self, raw):
        if self.password.startswith(('scrypt:', 'pbkdf2:')):
            return check_password_hash(self.password, raw)
        # Tương thích CSDL cũ lưu mật khẩu dạng chữ thường -> tự nâng cấp lên hash
        if secrets.compare_digest(self.password, raw):
            self.set_password(raw)
            db.session.commit()
            return True
        return False


class Course(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    teacher_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    attendance_pin = db.Column(db.String(10), default="")
    pin_created_at = db.Column(db.DateTime)


class Attendance(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey('course.id'))
    student_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    date = db.Column(db.String(20), default=lambda: datetime.now().strftime("%Y-%m-%d %H:%M"))
    status = db.Column(db.String(20))


class MaterialAndProgress(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey('course.id'))
    title = db.Column(db.String(150))
    filename = db.Column(db.String(200))       # Tên file lưu trên ổ đĩa (an toàn, duy nhất)
    original_name = db.Column(db.String(255))  # Tên file gốc để hiển thị / tải về
    completed_students = db.Column(db.Text, default="[]")

    def completed_ids(self):
        try:
            return {int(x) for x in json.loads(self.completed_students or "[]")}
        except (ValueError, TypeError):
            return set()


class Exam(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey('course.id'))
    title = db.Column(db.String(150))
    duration_minutes = db.Column(db.Integer, default=45)
    password = db.Column(db.String(50), default="")
    questions_json = db.Column(db.Text)


class ExamResult(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    exam_id = db.Column(db.Integer, db.ForeignKey('exam.id'))
    student_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    score = db.Column(db.Float, default=0.0)
    answers_json = db.Column(db.Text)
    cheat_warnings = db.Column(db.Integer, default=0)
    submitted_at = db.Column(db.DateTime, default=datetime.now)


class CalendarEvent(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150))
    event_date = db.Column(db.String(20))
    description = db.Column(db.String(300))


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_name = db.Column(db.String(100))
    action = db.Column(db.String(255))
    timestamp = db.Column(db.DateTime, default=datetime.now)


def log_action(user, action):
    db.session.add(AuditLog(user_name=user, action=action))
    db.session.commit()

# ================= TIỆN ÍCH: PHÂN QUYỀN, CSRF =================


def login_required(*roles):
    """Bắt buộc đăng nhập; nếu truyền roles thì chỉ các vai trò đó được truy cập."""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if 'user_id' not in session:
                if request.is_json or request.path.startswith(('/student/checkin', '/submit_exam', '/toggle_progress')):
                    return jsonify({'status': 'error', 'message': 'Phiên đăng nhập đã hết hạn.'}), 401
                return redirect(url_for('login'))
            user = db.session.get(User, session['user_id'])
            if not user or not user.is_active:
                session.clear()
                return redirect(url_for('login'))
            if roles and user.role not in roles:
                abort(403)
            return f(*args, **kwargs)
        return wrapper
    return decorator


def can_manage_course(course):
    """Admin quản lý mọi lớp; giáo viên chỉ quản lý lớp mình phụ trách."""
    role = session.get('role')
    return role == 'admin' or (role == 'teacher' and course.teacher_id == session.get('user_id'))


def managed_courses():
    if session.get('role') == 'admin':
        return Course.query.all()
    return Course.query.filter_by(teacher_id=session.get('user_id')).all()


def get_csrf_token():
    if '_csrf' not in session:
        session['_csrf'] = secrets.token_hex(16)
    return session['_csrf']


@app.context_processor
def inject_globals():
    return {'csrf_token': get_csrf_token}


@app.before_request
def csrf_protect():
    if request.method == 'POST':
        token = request.form.get('csrf_token') or request.headers.get('X-CSRFToken')
        if not token or not secrets.compare_digest(token, session.get('_csrf', '')):
            if request.is_json or request.headers.get('X-CSRFToken') is not None:
                return jsonify({'status': 'error', 'message': 'Phiên làm việc không hợp lệ, hãy tải lại trang.'}), 400
            flash('Phiên làm việc đã hết hạn, vui lòng thử lại.', 'danger')
            return redirect(request.referrer or url_for('login'))


@app.errorhandler(403)
def forbidden(e):
    return render_template('error.html', code=403, message='Bạn không có quyền truy cập chức năng này.'), 403


@app.errorhandler(404)
def not_found(e):
    return render_template('error.html', code=404, message='Không tìm thấy trang hoặc dữ liệu yêu cầu.'), 404


@app.errorhandler(413)
def too_large(e):
    return render_template('error.html', code=413, message='File tải lên quá lớn (tối đa 50MB).'), 413


def validate_questions(raw):
    """Kiểm tra JSON câu hỏi do giáo viên nhập. Trả về (list_câu_hỏi, lỗi)."""
    try:
        questions = json.loads(raw)
    except (ValueError, TypeError) as e:
        return None, f"JSON không hợp lệ: {e}"
    if not isinstance(questions, list) or not questions:
        return None, "Danh sách câu hỏi phải là một mảng JSON và không được rỗng."
    seen = set()
    for i, q in enumerate(questions, 1):
        if not isinstance(q, dict):
            return None, f"Câu {i}: phải là một đối tượng JSON."
        if 'id' not in q or str(q['id']) in seen:
            return None, f"Câu {i}: thiếu 'id' hoặc 'id' bị trùng."
        seen.add(str(q['id']))
        if not str(q.get('question', '')).strip():
            return None, f"Câu {i}: thiếu nội dung 'question'."
        if q.get('type') not in ('mc', 'essay'):
            return None, f"Câu {i}: 'type' phải là 'mc' (trắc nghiệm) hoặc 'essay' (tự luận)."
        if q['type'] == 'mc':
            opts = q.get('options')
            if not isinstance(opts, list) or len(opts) < 2:
                return None, f"Câu {i}: câu trắc nghiệm cần ít nhất 2 'options'."
            if q.get('answer') not in opts:
                return None, f"Câu {i}: 'answer' phải trùng với một trong các 'options'."
    return questions, None

# ================= ROUTES XÁC THỰC & ĐIỀU HƯỚNG =================


@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'GET' and 'user_id' in session:
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password) and user.is_active:
            csrf = session.get('_csrf')
            session.clear()
            session['_csrf'] = csrf or secrets.token_hex(16)
            session['user_id'] = user.id
            session['role'] = user.role
            session['full_name'] = user.full_name
            log_action(user.full_name, "Đăng nhập hệ thống")
            return redirect(url_for('dashboard'))
        return render_template('login.html', error="Sai tài khoản hoặc tài khoản đã bị khóa!")
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/dashboard')
@login_required()
def dashboard():
    role = session['role']
    uid = session['user_id']
    events = CalendarEvent.query.order_by(CalendarEvent.event_date.asc()).all()
    users_map = {u.id: u.full_name for u in User.query.all()}

    if role == 'admin':
        users = User.query.order_by(User.role, User.username).all()
        teachers = User.query.filter_by(role='teacher', is_active=True).all()
        courses = Course.query.all()
        logs = AuditLog.query.order_by(AuditLog.id.desc()).limit(25).all()
        return render_template('dashboard_admin.html', users=users, teachers=teachers, courses=courses,
                               events=events, logs=logs, users_map=users_map)

    if role == 'teacher':
        courses = managed_courses()
        course_ids = [c.id for c in courses]
        exams = Exam.query.filter(Exam.course_id.in_(course_ids)).all() if course_ids else []
        exam_ids = [e.id for e in exams]
        results = (ExamResult.query.filter(ExamResult.exam_id.in_(exam_ids))
                   .order_by(ExamResult.submitted_at.desc()).all()) if exam_ids else []
        attendances = (Attendance.query.filter(Attendance.course_id.in_(course_ids))
                       .order_by(Attendance.id.desc()).limit(100).all()) if course_ids else []
        students = User.query.filter_by(role='student', is_active=True).order_by(User.full_name).all()
        now = datetime.now()
        pin_expiry = {}
        for c in courses:
            if c.attendance_pin and c.pin_created_at:
                exp = c.pin_created_at + timedelta(minutes=PIN_VALID_MINUTES)
                if exp > now:
                    pin_expiry[c.id] = exp.strftime('%H:%M')
        return render_template('dashboard_teacher.html', courses=courses, exams=exams, results=results,
                               attendances=attendances, users_map=users_map, events=events,
                               students=students, statuses=ATTENDANCE_STATUSES,
                               courses_map={c.id: c.name for c in courses},
                               exams_map={e.id: e.title for e in exams}, pin_expiry=pin_expiry)

    # Học sinh
    courses = Course.query.all()
    exams = Exam.query.all()
    results = ExamResult.query.filter_by(student_id=uid).order_by(ExamResult.submitted_at.desc()).all()
    attendances = Attendance.query.filter_by(student_id=uid).order_by(Attendance.id.desc()).all()
    return render_template('dashboard_student.html', courses=courses, exams=exams, results=results,
                           attendances=attendances, events=events,
                           courses_map={c.id: c.name for c in courses},
                           exams_map={e.id: e.title for e in exams},
                           done_exam_ids={r.exam_id for r in results})

# ================= CHỨC NĂNG ADMIN =================


@app.route('/admin/add_user', methods=['POST'])
@login_required('admin')
def add_user():
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    full_name = request.form.get('full_name', '').strip()
    role = request.form.get('role', 'student')
    if not username or not password or not full_name or role not in ROLES:
        flash('Vui lòng nhập đầy đủ thông tin hợp lệ.', 'danger')
    elif User.query.filter_by(username=username).first():
        flash(f'Tên đăng nhập "{username}" đã tồn tại.', 'warning')
    else:
        u = User(username=username, full_name=full_name, role=role)
        u.set_password(password)
        db.session.add(u)
        db.session.commit()
        log_action(session['full_name'], f"Tạo tài khoản {username}")
        flash(f'Đã tạo tài khoản {username}.', 'success')
    return redirect(url_for('dashboard'))


@app.route('/admin/toggle_user/<int:user_id>', methods=['POST'])
@login_required('admin')
def toggle_user(user_id):
    u = db.get_or_404(User, user_id)
    if u.username == 'admin' or u.id == session['user_id']:
        flash('Không thể khóa tài khoản quản trị gốc hoặc chính mình.', 'warning')
    else:
        u.is_active = not u.is_active
        db.session.commit()
        log_action(session['full_name'], f"{'Mở khóa' if u.is_active else 'Khóa'} tài khoản {u.username}")
    return redirect(url_for('dashboard'))


@app.route('/admin/reset_password/<int:user_id>', methods=['POST'])
@login_required('admin')
def reset_password(user_id):
    u = db.get_or_404(User, user_id)
    new_pw = request.form.get('new_password', '')
    if len(new_pw) < 3:
        flash('Mật khẩu mới phải có ít nhất 3 ký tự.', 'danger')
    else:
        u.set_password(new_pw)
        db.session.commit()
        log_action(session['full_name'], f"Đặt lại mật khẩu cho {u.username}")
        flash(f'Đã đặt lại mật khẩu cho {u.username}.', 'success')
    return redirect(url_for('dashboard'))


@app.route('/admin/import_users', methods=['POST'])
@login_required('admin')
def import_users():
    file = request.files.get('file')
    if not file or not file.filename:
        flash('Chưa chọn file.', 'danger')
        return redirect(url_for('dashboard'))
    name = file.filename.lower()
    try:
        if name.endswith(('.xlsx', '.xls')):
            df = pd.read_excel(file, dtype=str)
        elif name.endswith('.csv'):
            df = pd.read_csv(file, dtype=str, encoding='utf-8-sig')
        else:
            flash('Chỉ hỗ trợ file .xlsx hoặc .csv.', 'danger')
            return redirect(url_for('dashboard'))
    except Exception as e:
        flash(f'Không đọc được file: {e}', 'danger')
        return redirect(url_for('dashboard'))

    df.columns = [str(c).strip().lower() for c in df.columns]
    required = {'username', 'password', 'full_name', 'role'}
    if not required.issubset(df.columns):
        flash(f'File thiếu cột: {", ".join(sorted(required - set(df.columns)))}', 'danger')
        return redirect(url_for('dashboard'))

    added, skipped = 0, 0
    existing = {u.username for u in User.query.all()}
    for _, row in df.fillna('').iterrows():
        uname = str(row['username']).strip()
        pw = str(row['password']).strip()
        fname = str(row['full_name']).strip()
        role = str(row['role']).strip().lower()
        if not uname or not pw or not fname or role not in ROLES or uname in existing:
            skipped += 1
            continue
        u = User(username=uname, full_name=fname, role=role)
        u.set_password(pw)
        db.session.add(u)
        existing.add(uname)
        added += 1
    db.session.commit()
    log_action(session['full_name'], f"Nhập {added} người dùng từ file {file.filename}")
    flash(f'Đã thêm {added} tài khoản, bỏ qua {skipped} dòng (trùng hoặc thiếu dữ liệu).', 'success')
    return redirect(url_for('dashboard'))


@app.route('/admin/create_course', methods=['POST'])
@login_required('admin', 'teacher')
def create_course():
    name = request.form.get('name', '').strip()
    if not name:
        flash('Tên lớp không được để trống.', 'danger')
        return redirect(url_for('dashboard'))
    if session['role'] == 'teacher':
        tid = session['user_id']  # Giáo viên chỉ tạo lớp cho chính mình
    else:
        tid = request.form.get('teacher_id', type=int)
        teacher = db.session.get(User, tid) if tid else None
        if not teacher or teacher.role != 'teacher':
            flash('Vui lòng chọn giáo viên phụ trách hợp lệ.', 'danger')
            return redirect(url_for('dashboard'))
    db.session.add(Course(name=name, teacher_id=tid))
    db.session.commit()
    log_action(session['full_name'], f"Tạo môn học/lớp: {name}")
    flash(f'Đã tạo lớp "{name}".', 'success')
    return redirect(url_for('dashboard'))


@app.route('/add_event', methods=['POST'])
@login_required('admin', 'teacher')
def add_event():
    title = request.form.get('title', '').strip()
    event_date = request.form.get('event_date', '').strip()
    if not title or not event_date:
        flash('Vui lòng nhập tên và ngày sự kiện.', 'danger')
        return redirect(url_for('dashboard'))
    db.session.add(CalendarEvent(title=title, event_date=event_date,
                                 description=request.form.get('description', '').strip()))
    db.session.commit()
    log_action(session['full_name'], f"Thêm sự kiện lịch: {title}")
    return redirect(url_for('dashboard'))

# ================= ĐIỂM DANH & XUẤT BÁO CÁO =================


@app.route('/teacher/generate_pin/<int:course_id>', methods=['POST'])
@login_required('admin', 'teacher')
def generate_pin(course_id):
    course = db.get_or_404(Course, course_id)
    if not can_manage_course(course):
        abort(403)
    pin = ''.join(random.SystemRandom().choices(string.digits, k=6))
    course.attendance_pin = pin
    course.pin_created_at = datetime.now()
    db.session.commit()
    log_action(session['full_name'], f"Mở điểm danh PIN lớp {course.name}")
    expires = (course.pin_created_at + timedelta(minutes=PIN_VALID_MINUTES)).strftime('%H:%M')
    return jsonify({'pin': pin, 'expires': expires})


@app.route('/teacher/close_pin/<int:course_id>', methods=['POST'])
@login_required('admin', 'teacher')
def close_pin(course_id):
    course = db.get_or_404(Course, course_id)
    if not can_manage_course(course):
        abort(403)
    course.attendance_pin = ""
    course.pin_created_at = None
    db.session.commit()
    return jsonify({'status': 'ok'})


def already_checked_in(course_id, student_id):
    today = datetime.now().strftime("%Y-%m-%d")
    return Attendance.query.filter(Attendance.course_id == course_id,
                                   Attendance.student_id == student_id,
                                   Attendance.date.like(f"{today}%")).first()


@app.route('/student/checkin', methods=['POST'])
@login_required('student')
def student_checkin():
    course_id = request.form.get('course_id', type=int)
    pin = request.form.get('pin', '').strip()
    course = db.session.get(Course, course_id) if course_id else None
    pin_ok = (course and pin and course.attendance_pin == pin and course.pin_created_at and
              datetime.now() - course.pin_created_at <= timedelta(minutes=PIN_VALID_MINUTES))
    if not pin_ok:
        return jsonify({'status': 'error', 'message': 'Mã PIN không đúng, đã hết hạn hoặc lớp chưa mở điểm danh!'})
    if already_checked_in(course.id, session['user_id']):
        return jsonify({'status': 'error', 'message': 'Bạn đã điểm danh lớp này hôm nay rồi.'})
    db.session.add(Attendance(course_id=course.id, student_id=session['user_id'], status="Có mặt"))
    db.session.commit()
    return jsonify({'status': 'success', 'message': f'Điểm danh thành công lớp {course.name}!'})


@app.route('/teacher/manual_attendance', methods=['POST'])
@login_required('admin', 'teacher')
def manual_attendance():
    course = db.get_or_404(Course, request.form.get('course_id', type=int))
    if not can_manage_course(course):
        abort(403)
    student = db.session.get(User, request.form.get('student_id', type=int) or 0)
    status = request.form.get('status')
    if not student or student.role != 'student' or status not in ATTENDANCE_STATUSES:
        flash('Dữ liệu điểm danh không hợp lệ.', 'danger')
        return redirect(url_for('dashboard'))
    att = already_checked_in(course.id, student.id)
    if att:
        att.status = status  # Cập nhật trạng thái trong ngày
    else:
        db.session.add(Attendance(course_id=course.id, student_id=student.id, status=status))
    db.session.commit()
    log_action(session['full_name'], f"Điểm danh thủ công: {student.full_name} - {status} - {course.name}")
    flash(f'Đã ghi nhận: {student.full_name} - {status}.', 'success')
    return redirect(url_for('dashboard'))


def excel_response(rows, sheet_name, filename):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, sheet_name=sheet_name)
    output.seek(0)
    return send_file(output, download_name=filename, as_attachment=True,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@app.route('/teacher/export_grades')
@login_required('admin', 'teacher')
def export_grades():
    course_ids = [c.id for c in managed_courses()]
    exams = Exam.query.filter(Exam.course_id.in_(course_ids)).all() if course_ids else []
    exams_map = {e.id: e.title for e in exams}
    results = ExamResult.query.filter(ExamResult.exam_id.in_(list(exams_map))).all() if exams_map else []
    users_map = {u.id: u.full_name for u in User.query.all()}
    rows = [{
        'Học sinh': users_map.get(r.student_id, 'N/A'),
        'Bài kiểm tra': exams_map.get(r.exam_id, 'N/A'),
        'Điểm số': r.score,
        'Số lần cảnh báo gian lận': r.cheat_warnings,
        'Thời gian nộp': r.submitted_at.strftime("%Y-%m-%d %H:%M:%S") if r.submitted_at else ''
    } for r in results]
    if not rows:
        rows = [{'Học sinh': '', 'Bài kiểm tra': '', 'Điểm số': '', 'Số lần cảnh báo gian lận': '', 'Thời gian nộp': ''}]
    return excel_response(rows, 'BangDiem', 'Bang_Diem_Lop_Hoc.xlsx')


@app.route('/teacher/export_attendance')
@login_required('admin', 'teacher')
def export_attendance():
    courses = managed_courses()
    courses_map = {c.id: c.name for c in courses}
    atts = (Attendance.query.filter(Attendance.course_id.in_(list(courses_map)))
            .order_by(Attendance.date).all()) if courses_map else []
    users_map = {u.id: u.full_name for u in User.query.all()}
    rows = [{'Lớp': courses_map.get(a.course_id, ''), 'Học sinh': users_map.get(a.student_id, 'N/A'),
             'Thời gian': a.date, 'Trạng thái': a.status} for a in atts]
    if not rows:
        rows = [{'Lớp': '', 'Học sinh': '', 'Thời gian': '', 'Trạng thái': ''}]
    return excel_response(rows, 'DiemDanh', 'Diem_Danh_Lop_Hoc.xlsx')

# ================= TÀI LIỆU & TIẾN ĐỘ HỌC =================


@app.route('/course/<int:course_id>/materials', methods=['GET', 'POST'])
@login_required()
def course_materials(course_id):
    course = db.get_or_404(Course, course_id)
    if request.method == 'POST':
        if not can_manage_course(course):
            abort(403)
        file = request.files.get('file')
        title = request.form.get('title', '').strip()
        if file and file.filename and title:
            ext = os.path.splitext(secure_filename(file.filename))[1].lower() or \
                  os.path.splitext(file.filename)[1].lower()[:10]
            stored = f"{uuid.uuid4().hex}{ext}"  # Tránh ghi đè & path traversal
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], stored))
            db.session.add(MaterialAndProgress(course_id=course_id, title=title, filename=stored,
                                               original_name=os.path.basename(file.filename)))
            db.session.commit()
            log_action(session['full_name'], f"Tải tài liệu '{title}' cho lớp {course.name}")
            flash('Đã tải tài liệu lên.', 'success')
        else:
            flash('Vui lòng nhập tên tài liệu và chọn file.', 'danger')
        return redirect(url_for('course_materials', course_id=course_id))

    materials = MaterialAndProgress.query.filter_by(course_id=course_id).all()
    total_students = User.query.filter_by(role='student', is_active=True).count()
    return render_template('chat_room.html', course=course, course_id=course_id, materials=materials,
                           total_students=total_students, can_manage=can_manage_course(course))


@app.route('/uploads/<path:filename>')
@login_required()
def download_file(filename):
    mat = MaterialAndProgress.query.filter_by(filename=filename).first()
    download_name = mat.original_name if mat and mat.original_name else filename
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename, download_name=download_name)


@app.route('/toggle_progress/<int:mat_id>', methods=['POST'])
@login_required('student')
def toggle_progress(mat_id):
    mat = db.get_or_404(MaterialAndProgress, mat_id)
    completed = mat.completed_ids()
    uid = session['user_id']
    if uid in completed:
        completed.discard(uid)
    else:
        completed.add(uid)
    mat.completed_students = json.dumps(sorted(completed))
    db.session.commit()
    return jsonify({'status': 'ok', 'completed': uid in completed})

# ================= THI TRỰC TUYẾN & CHỐNG GIAN LẬN =================


@app.route('/teacher/create_exam', methods=['POST'])
@login_required('teacher', 'admin')
def create_exam():
    course = db.get_or_404(Course, request.form.get('course_id', type=int))
    if not can_manage_course(course):
        abort(403)
    questions, err = validate_questions(request.form.get('questions_json', ''))
    duration = request.form.get('duration', type=int)
    title = request.form.get('title', '').strip()
    if err or not title or not duration or duration <= 0 or duration > 600:
        flash(err or 'Tên đề và thời gian (1–600 phút) là bắt buộc.', 'danger')
        return redirect(url_for('dashboard'))
    exam = Exam(course_id=course.id, title=title, duration_minutes=duration,
                password=request.form.get('password', '').strip(),
                questions_json=json.dumps(questions, ensure_ascii=False))
    db.session.add(exam)
    db.session.commit()
    log_action(session['full_name'], f"Tạo đề thi: {exam.title}")
    flash(f'Đã phát hành đề "{exam.title}" ({len(questions)} câu).', 'success')
    return redirect(url_for('dashboard'))


@app.route('/teacher/delete_exam/<int:exam_id>', methods=['POST'])
@login_required('teacher', 'admin')
def delete_exam(exam_id):
    exam = db.get_or_404(Exam, exam_id)
    course = db.session.get(Course, exam.course_id)
    if not course or not can_manage_course(course):
        abort(403)
    ExamResult.query.filter_by(exam_id=exam.id).delete()
    db.session.delete(exam)
    db.session.commit()
    log_action(session['full_name'], f"Xóa đề thi: {exam.title}")
    flash('Đã xóa đề thi.', 'success')
    return redirect(url_for('dashboard'))


@app.route('/exam/<int:exam_id>', methods=['GET', 'POST'])
@login_required('student')
def take_exam(exam_id):
    exam = db.get_or_404(Exam, exam_id)
    if ExamResult.query.filter_by(exam_id=exam.id, student_id=session['user_id']).first():
        flash('Bạn đã nộp bài thi này rồi.', 'warning')
        return redirect(url_for('dashboard'))

    started = session.get('exam_started', {})
    key = str(exam.id)
    if key not in started:  # Chưa vào phòng thi -> kiểm tra mật khẩu (nếu có)
        if exam.password:
            if request.method == 'GET':
                return render_template('exam_password.html', exam=exam)
            if not secrets.compare_digest(request.form.get('exam_password', ''), exam.password):
                return render_template('exam_password.html', exam=exam, error="Mật khẩu phòng thi không chính xác!")
        started[key] = datetime.now().timestamp()
        session['exam_started'] = started
        if request.method == 'POST':  # Tránh gửi lại form khi F5
            return redirect(url_for('take_exam', exam_id=exam.id))

    elapsed = datetime.now().timestamp() - started[key]
    time_left = max(0, int(exam.duration_minutes * 60 - elapsed))
    questions = json.loads(exam.questions_json)
    rnd = random.Random(f"{session['user_id']}-{exam.id}")  # Mỗi HS một thứ tự, ổn định khi tải lại
    rnd.shuffle(questions)
    safe_questions = [{k: v for k, v in q.items() if k != 'answer'} for q in questions]
    return render_template('exam_room.html', exam=exam, questions=safe_questions, time_left=time_left)


@app.route('/submit_exam/<int:exam_id>', methods=['POST'])
@login_required('student')
def submit_exam(exam_id):
    exam = db.get_or_404(Exam, exam_id)
    started = session.get('exam_started', {}).get(str(exam.id))
    if not started:
        return jsonify({'status': 'error', 'message': 'Bạn chưa vào phòng thi hợp lệ.'}), 403
    if ExamResult.query.filter_by(exam_id=exam.id, student_id=session['user_id']).first():
        return jsonify({'status': 'error', 'message': 'Bạn đã nộp bài thi này rồi.'}), 409
    if datetime.now().timestamp() - started > exam.duration_minutes * 60 + EXAM_GRACE_SECONDS:
        late = True
    else:
        late = False

    data = request.get_json(silent=True) or {}
    answers = data.get('answers') if isinstance(data.get('answers'), dict) else {}
    answers = {str(k): str(v)[:5000] for k, v in answers.items()}
    try:
        warnings = max(0, min(int(data.get('warnings', 0)), 99))
    except (TypeError, ValueError):
        warnings = 0

    questions = json.loads(exam.questions_json)
    mc = [q for q in questions if q.get('type') == 'mc']
    correct = sum(1 for q in mc if answers.get(str(q['id'])) == q['answer'])
    score = round(correct / len(mc) * 10, 2) if mc else 0.0

    db.session.add(ExamResult(exam_id=exam.id, student_id=session['user_id'], score=score,
                              answers_json=json.dumps(answers, ensure_ascii=False), cheat_warnings=warnings))
    db.session.commit()
    started_map = session.get('exam_started', {})
    started_map.pop(str(exam.id), None)
    session['exam_started'] = started_map
    log_action(session['full_name'], f"Nộp bài '{exam.title}' - {score}/10 - {warnings} cảnh báo"
               + (" - NỘP TRỄ" if late else ""))
    return jsonify({'status': 'submitted', 'score': score, 'late': late})


@app.route('/teacher/result/<int:result_id>')
@login_required('teacher', 'admin')
def view_result(result_id):
    r = db.get_or_404(ExamResult, result_id)
    exam = db.get_or_404(Exam, r.exam_id)
    course = db.session.get(Course, exam.course_id)
    if not course or not can_manage_course(course):
        abort(403)
    student = db.session.get(User, r.student_id)
    return render_template('result_detail.html', r=r, exam=exam, student=student,
                           questions=json.loads(exam.questions_json),
                           answers=json.loads(r.answers_json or '{}'))

# ================= PHÒNG TRÒ CHUYỆN LỚP HỌC (REALTIME) =================


@socketio.on('join')
def on_join(data):
    if 'user_id' not in session or not isinstance(data, dict):
        return False
    room = str(data.get('room', ''))
    if not room.startswith('course_') or not room[7:].isdigit() or not db.session.get(Course, int(room[7:])):
        return False
    join_room(room)


@socketio.on('message')
def handle_message(data):
    if 'user_id' not in session or not isinstance(data, dict):
        return False
    room = str(data.get('room', ''))
    msg = str(data.get('msg', '')).strip()[:1000]
    if not msg or room not in rooms():  # Chỉ gửi vào phòng đã tham gia
        return False
    send({'user': session.get('full_name', 'Ẩn danh'), 'msg': msg,
          'time': datetime.now().strftime('%H:%M')}, to=room)

# ================= KHỞI TẠO CSDL =================


def migrate_sqlite():
    """Thêm các cột mới vào CSDL cũ (bản trước) để không bị lỗi khi nâng cấp."""
    if not app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite'):
        return
    insp = inspect(db.engine)
    for table in db.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        existing = {c['name'] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name not in existing:
                with db.engine.begin() as conn:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" '
                                      f'{col.type.compile(db.engine.dialect)}'))


def init_db():
    db.create_all()
    migrate_sqlite()
    if User.query.first():
        return
    admin = User(username='admin', full_name='Quản Trị Viên', role='admin')
    gv = User(username='gv1', full_name='Thầy Nguyễn Văn A', role='teacher')
    hs = User(username='hs1', full_name='Em Trần Thị B', role='student')
    for u in (admin, gv, hs):
        u.set_password('123')
    db.session.add_all([admin, gv, hs])
    db.session.commit()

    c1 = Course(name='Toán Cao Cấp - Lớp 12A1', teacher_id=gv.id)
    db.session.add(c1)
    db.session.commit()

    sample_questions = [
        {"id": 1, "level": "Dễ", "type": "mc", "question": "2 + 2 bằng mấy?", "options": ["3", "4", "5", "6"], "answer": "4"},
        {"id": 2, "level": "Trung bình", "type": "mc", "question": "Đạo hàm của x^2 là gì?", "options": ["x", "2x", "x^2", "2"], "answer": "2x"},
        {"id": 3, "level": "Khó", "type": "essay", "question": "Trình bày ứng dụng của tích phân trong tính diện tích hình phẳng."}
    ]
    db.session.add(Exam(course_id=c1.id, title="Kiểm tra 15 phút Giải tích", duration_minutes=15, password="",
                        questions_json=json.dumps(sample_questions, ensure_ascii=False)))
    db.session.add(CalendarEvent(title="Kiểm tra giữa kỳ Toán", event_date="2026-12-05",
                                 description="Học sinh mang theo máy tính bỏ túi."))
    db.session.commit()


with app.app_context():
    init_db()


if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', 5000))
    print(f"=== HỆ THỐNG LMS & THI OFFLINE ĐANG CHẠY TẠI http://{host}:{port} ===")
    # allow_unsafe_werkzeug=True: bắt buộc với Flask-SocketIO >= 5.3 khi chạy server tích hợp (phù hợp mạng LAN)
    socketio.run(app, host=host, port=port, debug=False, allow_unsafe_werkzeug=True)
