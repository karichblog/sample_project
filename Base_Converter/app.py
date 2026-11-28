import struct
from flask import Flask, send_file, request, jsonify

app = Flask(__name__)

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

def format_float_with_steps(num, base, precision=10):
    chars = "0123456789ABCDEF"
    is_neg = num < 0
    abs_num = abs(num)
    
    int_part = int(abs_num)
    frac_part = round(abs_num - int_part, 12)
    steps = []
    
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

def get_ieee754(num):
    try:
        packed32 = struct.pack('>f', num)
        bin32 = ''.join(f'{b:08b}' for b in packed32)
        hex32 = packed32.hex().upper()
        fmt32 = f"{bin32[0]} | {bin32[1:9]} | {bin32[9:]}"

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

@app.route('/')
def index():
    return send_file('index.html')

if __name__ == '__main__':
    app.run(debug=True)
