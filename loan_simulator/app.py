from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

def calculate_loan_schedule(principal, months, rate_initial, promo_months, rate_floating):
    monthly_principal = principal / months
    remaining_balance = principal
    total_interest = 0
    schedule = []

    for m in range(1, months + 1):
        current_rate = rate_initial if m <= promo_months else rate_floating
        monthly_interest = remaining_balance * (current_rate / 100 / 12)
        total_payment = monthly_principal + monthly_interest

        schedule.append({
            "month": m,
            "rate": current_rate,
            "principal": round(monthly_principal),
            "interest": round(monthly_interest),
            "total_payment": round(total_payment),
            "remaining": max(0, round(remaining_balance - monthly_principal))
        })

        total_interest += monthly_interest
        remaining_balance -= monthly_principal

    return {
        "month_1": schedule[0]["total_payment"] if months >= 1 else 0,
        "month_25": schedule[24]["total_payment"] if months >= 25 else schedule[-1]["total_payment"],
        "total_interest": round(total_interest),
        "total_cost": round(principal + total_interest),
        "schedule": schedule
    }

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/calculate", methods=["POST"])
def calculate():
    data = request.json
    principal = float(data.get("principal", 1000000000))
    months = int(data.get("months", 120))

    fixed = calculate_loan_schedule(
        principal, months,
        float(data.get("fixed_rate", 9.5)),
        months,
        float(data.get("fixed_rate", 9.5))
    )

    hybrid = calculate_loan_schedule(
        principal, months,
        float(data.get("hybrid_promo_rate", 7.5)),
        int(data.get("hybrid_promo_months", 24)),
        float(data.get("hybrid_float_rate", 11.5))
    )

    floating = calculate_loan_schedule(
        principal, months,
        float(data.get("float_init_rate", 10.5)),
        int(data.get("hybrid_promo_months", 24)),
        float(data.get("float_later_rate", 12.0))
    )

    return jsonify({
        "fixed": fixed,
        "hybrid": hybrid,
        "floating": floating
    })

if __name__ == "__main__":
    app.run(debug=True)
