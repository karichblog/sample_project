import struct
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# Chuyển đổi chuỗi số dấu phẩy động từ hệ bất kỳ sang hệ 10
def parse_float_base(val_str, base):
    val_str = val_str.strip().upper()
    is_neg = val_str.startswith('-')
    if is_neg:
        val_str = val_str[1:]
    
    if '.' not in val_str:
        num = float(int(val_str, base))
    else:
        parts = val_str.split('.')
        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ValueError("Định dạng dấu phẩy động không hợp lệ")
        int_part = int(parts[0], base)
        frac_part = 0.0
        for i, char in enumerate(parts[1]):
            digit = int(char, base)
            frac_part += digit * (base ** -(i + 1))
        num = int_part + frac_part
        
    return -num if is_neg else num

# Chuyển đổi số thực hệ 10 sang hệ bất kỳ kèm các bước giải chi tiết
def format_float_with_steps(num, base, precision=10):
    chars = "0123456789ABCDEF"
    is_neg = num < 0
    abs_num = abs(num)
    
    int_part = int(abs_num)
    frac_part = round(abs_num - int_part, 12)
    steps = []
    
    # 1. Các bước xử lý phần nguyên (Chia lấy dư)
    if int_part == 0:
        int_str = "0"
        steps.append(f"• Phần nguyên là 0 => 0 (hệ {base})")
    else:
        int_digits = []
        temp_int = int_part
        steps.append(f"• Chia phần nguyên ({int_part}) liên tiếp cho {base}:")
        while temp_int > 0:
            q, r = divmod(temp_int, base)
            steps.append(f"   {temp_int} : {base} = {q} dư {r} ({chars[r]})")
            int_digits.append(chars[r])
            temp_int = q
        int_str = "".join(reversed(int_digits))
        steps.append(f"   => Đọc ngược phần dư: {int_str}")
        
    # 2. Các bước xử lý phần thập phân (Nhân lấy phần nguyên)
    if frac_part == 0:
        res = int_str
    else:
        frac_digits = []
        temp_frac = frac_part
        count = 0
        steps.append(f"• Nhân phần lẻ ({frac_part}) liên tiếp với {base}:")
        while temp_frac > 1e-11 and count < precision:
            prod = round(temp_frac * base, 11)
            digit = int(prod)
            rem = round(prod - digit, 11)
            steps.append(f"   {temp_frac} × {base} = {prod} => lấy {digit} ({chars[digit]})")
            frac_digits.append(chars[digit])
            temp_frac = rem
            count += 1
        res = f"{int_str}.{''.join(frac_digits)}"
        steps.append(f"   => Đọc xuôi phần nguyên: .{''.join(frac_digits)}")
        
    final_res = f"-{res}" if is_neg else res
    return final_res, "\n".join(steps)

# Biểu diễn Bù 2 (Two's Complement)
def get_twos_complement(num_float):
    if not num_float.is_integer():
        msg = "Chỉ áp dụng cho số nguyên"
        return {"8bit": msg, "16bit": msg, "32bit": msg}
    
    n = int(num_float)
    res = {}
    for bits in [8, 16, 32]:
        min_val = -(1 << (bits - 1))
        max_val = (1 << (bits - 1)) - 1
        if min_val <= n <= max_val:
            val = n & ((1 << bits) - 1)
            bin_str = format(val, f'0{bits}b')
            res[f"{bits}bit"] = ' '.join(bin_str[i:i+4] for i in range(0, bits, 4))
        else:
            res[f"{bits}bit"] = f"Tràn số ({min_val} đến {max_val})"
    return res

# Biểu diễn chuẩn IEEE 754 (32-bit & 64-bit)
def get_ieee754(num):
    try:
        # 32-bit Single Precision
        packed32 = struct.pack('>f', num)
        bin32 = ''.join(f'{b:08b}' for b in packed32)
        hex32 = packed32.hex().upper()
        fmt32 = f"{bin32[0]} | {bin32[1:9]} | {bin32[9:]}"

        # 64-bit Double Precision
        packed64 = struct.pack('>d', num)
        bin64 = ''.join(f'{b:08b}' for b in packed64)
        hex64 = packed64.hex().upper()
        fmt64 = f"{bin64[0]} | {bin64[1:12]} | {bin64[12:]}"

        return {
            "bin32": fmt32, "hex32": hex32,
            "bin64": fmt64, "hex64": hex64
        }
    except OverflowError:
        return {"bin32": "Tràn số", "hex32": "N/A", "bin64": "Tràn số", "hex64": "N/A"}

def build_response(num, input_explain=""):
    bin_val, bin_steps = format_float_with_steps(num, 2)
    oct_val, oct_steps = format_float_with_steps(num, 8)
    hex_val, hex_steps = format_float_with_steps(num, 16)
    dec_str = str(round(num, 12)).rstrip('0').rstrip('.') if '.' in str(num) else str(int(num))
    
    return {
        'bin': bin_val,
        'oct': oct_val,
        'dec': dec_str,
        'hex': hex_val,
        'twos': get_twos_complement(num),
        'ieee': get_ieee754(num),
        'steps': {
            'input': input_explain,
            'bin': bin_steps,
            'oct': oct_steps,
            'hex': hex_steps
        }
    }

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/convert', methods=['POST'])
def convert():
    data = request.json
    value = data.get('value', '').strip()
    base = int(data.get('base', 10))
    
    if not value:
        return jsonify({'error': 'Vui lòng nhập giá trị!'}), 400
    
    try:
        num = parse_float_base(value, base)
        dec_str = str(round(num, 12)).rstrip('0').rstrip('.') if '.' in str(num) else str(int(num))
        explain = f"Giá trị trung gian hệ 10: {value} (hệ {base}) = {dec_str} (hệ 10)"
        return jsonify(build_response(num, explain))
    except ValueError:
        return jsonify({'error': f'Giá trị không hợp lệ cho hệ cơ số {base}!'}), 400

@app.route('/api/calculate', methods=['POST'])
def calculate():
    data = request.json
    val1 = data.get('val1', '').strip()
    val2 = data.get('val2', '').strip()
    base = int(data.get('base', 10))
    op = data.get('op', '+')
    
    if not val1 or (op != 'NOT' and not val2):
        return jsonify({'error': 'Vui lòng nhập đủ dữ liệu!'}), 400
        
    try:
        n1 = parse_float_base(val1, base)
        n2 = parse_float_base(val2, base) if op != 'NOT' else 0
        
        if op in ['+', '-', '*', '/']:
            if op == '+': res = n1 + n2
            elif op == '-': res = n1 - n2
            elif op == '*': res = n1 * n2
            elif op == '/':
                if n2 == 0: return jsonify({'error': 'Không thể chia cho 0!'}), 400
                res = n1 / n2
            explain = f"Quy về hệ 10 để tính: {n1} {op} {n2} = {res}"
        elif op in ['AND', 'OR', 'XOR', 'NOT']:
            if not n1.is_integer() or (op != 'NOT' and not n2.is_integer()):
                return jsonify({'error': 'Phép toán logic chỉ áp dụng cho số nguyên!'}), 400
            i1, i2 = int(n1), int(n2)
            if op == 'AND': res = float(i1 & i2)
            elif op == 'OR': res = float(i1 | i2)
            elif op == 'XOR': res = float(i1 ^ i2)
            elif op == 'NOT': res = float(~i1)
            explain = f"Phép toán logic trên hệ 10: {i1} {op} {i2 if op != 'NOT' else ''} = {int(res)}"
        else:
            return jsonify({'error': 'Phép tính không hợp lệ!'}), 400
            
        return jsonify(build_response(res, explain))
    except ValueError:
        return jsonify({'error': f'Số nhập vào không đúng định dạng hệ {base}!'}), 400

if __name__ == '__main__':
    app.run(debug=True)
