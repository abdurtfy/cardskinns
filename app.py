import os
import hmac
import hashlib
import json
import logging
from flask import Flask, request, jsonify
from email_sender import send_ebook_email
from sheets_logger import log_payment, ensure_header
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")


def verify_signature(payload_body: bytes, signature: str) -> bool:
    """Verify the Razorpay webhook signature using HMAC-SHA256."""
    expected = hmac.new(
        RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        payload_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@app.route("/webhook/razorpay", methods=["POST"])
def razorpay_webhook():
    """Endpoint that receives Razorpay webhook events."""
    signature = request.headers.get("X-Razorpay-Signature", "")

    if not signature:
        logger.warning("Request missing X-Razorpay-Signature header.")
        return jsonify({"error": "Missing signature"}), 400

    raw_body = request.get_data()

    if not verify_signature(raw_body, signature):
        logger.warning("Invalid webhook signature. Possible spoofed request.")
        return jsonify({"error": "Invalid signature"}), 403

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        logger.error("Failed to parse JSON body.")
        return jsonify({"error": "Invalid JSON"}), 400

    event = payload.get("event")
    logger.info(f"Received event: {event}")

    if event != "payment.captured":
        logger.info(f"Ignoring non-target event: {event}")
        return jsonify({"status": "ignored"}), 200

    try:
        payment = payload["payload"]["payment"]["entity"]
        email      = payment.get("email", "")
        name       = payment.get("notes", {}).get("name", "Valued Customer")
        amount_inr = payment.get("amount", 0) / 100

        if not email:
            logger.error("No email found in payment payload.")
            return jsonify({"error": "No email in payload"}), 422

        logger.info(f"Payment captured: ₹{amount_inr:.2f} from {email}")

        # 1. Send the eBook email
        send_ebook_email(name=name, email=email)
        logger.info(f"eBook email sent successfully to {email}")

        # 2. Log to Google Sheets — only on success
        log_payment(name=name, email=email, amount_inr=amount_inr, status="Email Sent")

    except KeyError as e:
        logger.error(f"Unexpected payload structure: {e}")
        return jsonify({"error": f"Missing key: {e}"}), 422

    return jsonify({"status": "ok"}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"}), 200


if __name__ == "__main__":
    try:
        ensure_header()
    except Exception as e:
        logger.warning(f"Could not initialise Google Sheet header: {e}")

    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
