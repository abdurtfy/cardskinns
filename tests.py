import hashlib
import hmac
import json
import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "test_secret")
os.environ.setdefault("SMTP_USER",     "test@example.com")
os.environ.setdefault("SMTP_PASSWORD", "test_password")

from app import app, verify_signature  # noqa: E402


def make_signature(body: bytes, secret: str = "test_secret") -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def captured_payload(email="buyer@example.com", name="Test User", amount=49900):
    return {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "email": email,
                    "amount": amount,
                    "notes": {"name": name},
                }
            }
        },
    }


class TestSignatureVerification(unittest.TestCase):
    def test_valid_signature(self):
        body = b'{"event":"payment.captured"}'
        sig  = make_signature(body)
        self.assertTrue(verify_signature(body, sig))

    def test_invalid_signature(self):
        body = b'{"event":"payment.captured"}'
        self.assertFalse(verify_signature(body, "deadbeef"))

    def test_tampered_body(self):
        original  = b'{"amount":100}'
        tampered  = b'{"amount":999}'
        sig = make_signature(original)
        self.assertFalse(verify_signature(tampered, sig))


class TestWebhookEndpoint(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()

    # ── helpers ──────────────────────────────────────────────────────────────

    def _post(self, payload, secret="test_secret", sig_override=None):
        body = json.dumps(payload).encode()
        sig  = sig_override or make_signature(body, secret)
        return self.client.post(
            "/webhook/razorpay",
            data=body,
            content_type="application/json",
            headers={"X-Razorpay-Signature": sig},
        )

    # ── tests ─────────────────────────────────────────────────────────────────

    def test_missing_signature_returns_400(self):
        r = self.client.post("/webhook/razorpay", data=b"{}", content_type="application/json")
        self.assertEqual(r.status_code, 400)

    def test_invalid_signature_returns_403(self):
        r = self._post(captured_payload(), sig_override="badsig")
        self.assertEqual(r.status_code, 403)

    @patch("app.send_ebook_email")
    def test_payment_captured_sends_email(self, mock_send):
        payload = captured_payload(email="alice@example.com", name="Alice")
        r = self._post(payload)
        self.assertEqual(r.status_code, 200)
        mock_send.assert_called_once_with(name="Alice", email="alice@example.com")

    @patch("app.send_ebook_email")
    def test_non_captured_event_is_ignored(self, mock_send):
        payload = {"event": "payment.failed", "payload": {}}
        r = self._post(payload)
        self.assertEqual(r.status_code, 200)
        mock_send.assert_not_called()

    @patch("app.send_ebook_email")
    def test_missing_email_returns_422(self, mock_send):
        payload = captured_payload(email="")
        r = self._post(payload)
        self.assertEqual(r.status_code, 422)
        mock_send.assert_not_called()

    def test_health_endpoint(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json(), {"status": "healthy"})


class TestEmailSender(unittest.TestCase):
    @patch("email_sender.smtplib.SMTP")
    def test_email_is_sent(self, mock_smtp_cls):
        mock_server = MagicMock()
        mock_smtp_cls.return_value.__enter__.return_value = mock_server

        from email_sender import send_ebook_email
        send_ebook_email(name="Bob", email="bob@example.com")

        mock_server.sendmail.assert_called_once()
        args = mock_server.sendmail.call_args[0]
        self.assertEqual(args[1], "bob@example.com")

    @patch("email_sender.SMTP_USER", "")
    def test_missing_smtp_credentials_raises(self):
        from email_sender import send_ebook_email
        with self.assertRaises(ValueError):
            send_ebook_email(name="X", email="x@example.com")


if __name__ == "__main__":
    unittest.main(verbosity=2)
