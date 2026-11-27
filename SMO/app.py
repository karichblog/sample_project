import os
import io
import json
import random
import string
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_from_directory, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, join_room, send
import pandas as pd

app = Flask(__name__)
app.config['SECRET_KEY'] = 'offline_secret_key_2026'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# ================= CƠ SỞ DỮ LIỆU (MODELS) =================

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(50), nullable=False)
    full_name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), nullable=False) # 'admin', 'teacher', 'student'
    is_active = db.Column(db.Boolean, default=True)

class Course(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    teacher_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    attendance_pin = db.Column(db.String(10), default="")

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
    filename = db.Column(db.String(200))
    completed_students = db.Column(db.Text, default="[]")

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

# ================= ROUTES XÁC THỰC & ĐIỀU HƯỚNG =================

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username'], password=request.form['password']).first()
        if user and user.is_active:
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
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    role = session['role']
    events = CalendarEvent.query.order_by(CalendarEvent.event_date.asc()).all()
    courses = Course.query.all()
    
    if role == 'admin':
        users = User.query.all()
        teachers = User.query.filter_by(role='teacher').all()
        logs = AuditLog.query.order_by(AuditLog.id.desc()).limit(25).all()
        return render_template('dashboard_admin.html', users=users, teachers=teachers, courses=courses, events=events, logs=logs)
    elif role == 'teacher':
        exams = Exam.query.all()
        results = ExamResult.query.all()
        attendances = Attendance.query.all()
        users_map = {u.id: u.full_name for u in User.query.all()}
        return render_template('dashboard_teacher.html', courses=courses, exams=exams, results=results, attendances=attendances, users_map=users_map, events=events)
    else:
        exams = Exam.query.all()
        results = ExamResult.query.filter_by(student_id=session['user_id']).all()
        attendances = Attendance.query.filter_by(student_id=session['user_id']).all()
        return render_template('dashboard_student.html', courses=courses, exams=exams, results=results, attendances=attendances, events=events)

# ================= CHỨC NĂNG ADMIN =================

@app.route('/admin/add_user', methods=['POST'])
def add_user():
    if session.get('role') != 'admin': return redirect(url_for('login'))
    username = request.form['username']
    if not User.query.filter_by(username=username).first():
        u = User(username=username, password=request.form['password'], full_name=request.form['full_name'], role=request.form['role'])
        db.session.add(u)
        db.session.commit()
        log_action(session['full_name'], f"Tạo tài khoản {username}")
    return redirect(url_for('dashboard'))

@app.route('/admin/toggle_user/<int:user_id>')
def toggle_user(user_id):
    if session.get('role') != 'admin': return redirect(url_for('login'))
    u = User.query.get(user_id)
    if u and u.username != 'admin':
        u.is_active = not u.is_active
        db.session.commit()
        log_action(session['full_name'], f"Đổi trạng thái tài khoản {u.username}")
    return redirect(url_for('dashboard'))

@app.route('/admin/import_users', methods=['POST'])
def import_users():
    if session.get('role') != 'admin': return redirect(url_for('login'))
    file = request.files.get('file')
    if file and file.filename:
        df = pd.read_excel(file) if file.filename.endswith('.xlsx') else pd.read_csv(file)
        for _, row in df.iterrows():
            uname = str(row['username']).strip()
            if not User.query.filter_by(username=uname).first():
                new_user = User(username=uname, password=str(row['password']).strip(),
                                full_name=str(row['full_name']).strip(), role=str(row['role']).strip())
                db.session.add(new_user)
        db.session.commit()
        log_action(session['full_name'], "Nhập danh sách người dùng từ file Excel/CSV")
    return redirect(url_for('dashboard'))

@app.route('/admin/create_course', methods=['POST'])
def create_course():
    if session.get('role') not in ['admin', 'teacher']: return redirect(url_for('login'))
    tid = request.form.get('teacher_id') or session['user_id']
    new_course = Course(name=request.form['name'], teacher_id=tid)
    db.session.add(new_course)
    db.session.commit()
    log_action(session['full_name'], f"Tạo môn học/lớp: {request.form['name']}")
    return redirect(url_for('dashboard'))

@app.route('/add_event', methods=['POST'])
def add_event():
    if 'user_id' not in session: return redirect(url_for('login'))
    ev = CalendarEvent(title=request.form['title'], event_date=request.form['event_date'], description=request.form['description'])
    db.session.add(ev)
    db.session.commit()
    log_action(session['full_name'], f"Thêm sự kiện lịch: {request.form['title']}")
    return redirect(url_for('dashboard'))

# ================= ĐIỂM DANH & XUẤT BÁO CÁO =================

@app.route('/teacher/generate_pin/<int:course_id>')
def generate_pin(course_id):
    course = Course.query.get(course_id)
    pin = ''.join(random.choices(string.digits, k=6))
    course.attendance_pin = pin
    db.session.commit()
    return jsonify({'pin': pin})

@app.route('/student/checkin', methods=['POST'])
def student_checkin():
    course_id = request.form['course_id']
    pin = request.form['pin'].strip()
    course = Course.query.get(course_id)
    if course and course.attendance_pin == pin and pin != "":
        att = Attendance(course_id=course_id, student_id=session['user_id'], status="Có mặt")
        db.session.add(att)
        db.session.commit()
        return jsonify({'status': 'success', 'message': 'Điểm danh thành công!'})
    return jsonify({'status': 'error', 'message': 'Mã PIN không đúng hoặc lớp chưa mở điểm danh!'})

@app.route('/teacher/export_grades')
def export_grades():
    results = ExamResult.query.all()
    users_map = {u.id: u.full_name for u in User.query.all()}
    exams_map = {e.id: e.title for e in Exam.query.all()}
    data = [{
        'Học sinh': users_map.get(r.student_id, 'N/A'),
        'Bài kiểm tra': exams_map.get(r.exam_id, 'N/A'),
        'Điểm số': r.score,
        'Số lần cảnh báo gian lận': r.cheat_warnings,
        'Thời gian nộp': r.submitted_at.strftime("%Y-%m-%d %H:%M:%S")
    } for r in results]
    df = pd.DataFrame(data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='BangDiem')
    output.seek(0)
    return send_file(output, download_name="Bang_Diem_Lop_Hoc.xlsx", as_attachment=True)

# ================= TÀI LIỆU & TIẾN ĐỘ HỌC =================

@app.route('/course/<int:course_id>/materials', methods=['GET', 'POST'])
def course_materials(course_id):
    if 'user_id' not in session: return redirect(url_for('login'))
    course = Course.query.get(course_id)
    if request.method == 'POST' and session['role'] in ['teacher', 'admin']:
        file = request.files['file']
        if file and file.filename:
            filename = file.filename
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            mat = MaterialAndProgress(course_id=course_id, title=request.form['title'], filename=filename)
            db.session.add(mat)
            db.session.commit()
    materials = MaterialAndProgress.query.filter_by(course_id=course_id).all()
    return render_template('chat_room.html', course=course, course_id=course_id, materials=materials)

@app.route('/uploads/<filename>')
def download_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/toggle_progress/<int:mat_id>', methods=['POST'])
def toggle_progress(mat_id):
    mat = MaterialAndProgress.query.get(mat_id)
    completed = json.loads(mat.completed_students)
    uid = session['user_id']
    if uid in completed:
        completed.remove(uid)
    else:
        completed.append(uid)
    mat.completed_students = json.dumps(completed)
    db.session.commit()
    return jsonify({'status': 'ok', 'completed': uid in completed})

# ================= THI TRỰC TUYẾN & CHỐNG GIAN LẬN =================

@app.route('/teacher/create_exam', methods=['POST'])
def create_exam():
    if session.get('role') not in ['teacher', 'admin']: return redirect(url_for('login'))
    exam = Exam(
        course_id=request.form['course_id'],
        title=request.form['title'],
        duration_minutes=int(request.form['duration']),
        password=request.form.get('password', ''),
        questions_json=request.form['questions_json']
    )
    db.session.add(exam)
    db.session.commit()
    log_action(session['full_name'], f"Tạo đề thi: {exam.title}")
    return redirect(url_for('dashboard'))

@app.route('/exam/<int:exam_id>', methods=['GET', 'POST'])
def take_exam(exam_id):
    if 'user_id' not in session: return redirect(url_for('login'))
    exam = Exam.query.get(exam_id)
    if exam.password and request.method == 'POST':
        if request.form.get('exam_password') != exam.password:
            return render_template('exam_password.html', exam=exam, error="Mật khẩu phòng thi không chính xác!")
    elif exam.password and request.method == 'GET':
        return render_template('exam_password.html', exam=exam)

    questions = json.loads(exam.questions_json)
    random.shuffle(questions)
    return render_template('exam_room.html', exam=exam, questions=questions)

@app.route('/submit_exam/<int:exam_id>', methods=['POST'])
def submit_exam(exam_id):
    data = request.json
    exam = Exam.query.get(exam_id)
    questions = json.loads(exam.questions_json)
    
    correct = 0
    total_mc = 0
    for q in questions:
        if q['type'] == 'mc':
            total_mc += 1
            if data['answers'].get(str(q['id'])) == q['answer']:
                correct += 1
    score = round((correct / total_mc) * 10, 2) if total_mc > 0 else 0.0

    result = ExamResult(
        exam_id=exam_id,
        student_id=session['user_id'],
        score=score,
        answers_json=json.dumps(data['answers']),
        cheat_warnings=data['warnings']
    )
    db.session.add(result)
    db.session.commit()
    return jsonify({'status': 'submitted', 'score': score})

# ================= PHÒNG TRÒ CHUYỆN LỚP HỌC (REALTIME) =================

@socketio.on('join')
def on_join(data):
    join_room(data['room'])

@socketio.on('message')
def handle_message(data):
    send({'user': session.get('full_name', 'Ẩn danh'), 'msg': data['msg']}, to=data['room'])

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        if not User.query.filter_by(username='admin').first():
            db.session.add(User(username='admin', password='123', full_name='Quản Trị Viên', role='admin'))
            gv = User(username='gv1', password='123', full_name='Thầy Nguyễn Văn A', role='teacher')
            hs = User(username='hs1', password='123', full_name='Em Trần Thị B', role='student')
            db.session.add_all([gv, hs])
            db.session.commit()
            
            c1 = Course(name='Toán Cao Cấp - Lớp 12A1', teacher_id=gv.id)
            db.session.add(c1)
            db.session.commit()

            sample_questions = [
                {"id": 1, "level": "Dễ", "type": "mc", "question": "2 + 2 bằng mấy?", "options": ["3", "4", "5", "6"], "answer": "4"},
                {"id": 2, "level": "Trung bình", "type": "mc", "question": "Đạo hàm của x^2 là gì?", "options": ["x", "2x", "x^2", "2"], "answer": "2x"},
                {"id": 3, "level": "Khó", "type": "essay", "question": "Trình bày ứng dụng của tích phân trong tính diện tích hình phẳng."}
            ]
            ex = Exam(course_id=c1.id, title="Kiểm tra 15 phút Giải tích", duration_minutes=15, password="", questions_json=json.dumps(sample_questions, ensure_ascii=False))
            db.session.add(ex)
            db.session.add(CalendarEvent(title="Kiểm tra giữa kỳ Toán", event_date="2026-12-05", description="Học sinh mang theo máy tính bỏ túi."))
            db.session.commit()

    print("=== HỆ THỐNG LMS & THI OFFLINE ĐANG CHẠY TẠI http://0.0.0.0:5000 ===")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
