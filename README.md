# Razorpay eBook Automation Bot

A lightweight, backend-only service that automatically emails a Google Drive eBook link to customers the moment a Razorpay payment is captured. No database, no frontend, no manual work.

---

## Project Structure

```
razorpay-ebook-bot/
├── app.py            # Flask webhook listener & signature verification
├── email_sender.py   # SMTP email composition and delivery
├── tests.py          # Unit tests (no network/SMTP calls needed)
├── requirements.txt  # Python dependencies
├── .env.example      # All required environment variables (copy → .env)
└── README.md
```

---

## Quick Start

### 1. Clone & install dependencies

```bash
git clone <your-repo>
cd razorpay-ebook-bot
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Open .env and fill in every value
```

| Variable | Description |
|---|---|
| `RAZORPAY_WEBHOOK_SECRET` | Secret from Razorpay Dashboard → Webhooks |
| `SMTP_SERVER` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | `587` for TLS |
| `SMTP_USER` | Your Gmail address |
| `SMTP_PASSWORD` | Gmail **App Password** (not your login password) |
| `EBOOK_DRIVE_LINK` | Public Google Drive share link to your eBook |
| `EMAIL_SUBJECT` | Subject line for the delivery email |
| `EMAIL_BODY_TEMPLATE` | Body text — use `{name}` and `{link}` as placeholders |

> **Gmail App Password**: Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), create an app password for "Mail", and paste the 16-character code into `SMTP_PASSWORD`.

### 3. Run the server

```bash
# Development
python app.py

# Production (Gunicorn)
gunicorn app:app --bind 0.0.0.0:5000 --workers 2
```

### 4. Run the tests

```bash
python -m pytest tests.py -v
```

---

## Exposing the Webhook (Local Development)

Use [ngrok](https://ngrok.com/) or [localtunnel](https://github.com/localtunnel/localtunnel) to get a public HTTPS URL:

```bash
ngrok http 5000
# → Forwarding: https://abc123.ngrok.io → localhost:5000
```

Your webhook URL will be:
```
https://abc123.ngrok.io/webhook/razorpay
```

---

## Razorpay Dashboard Setup

1. Go to **Settings → Webhooks → Add New Webhook**.
2. Set the **URL** to your public endpoint (`/webhook/razorpay`).
3. Set a **Secret** and copy it into `RAZORPAY_WEBHOOK_SECRET` in your `.env`.
4. Enable the **`payment.captured`** event.
5. Save.

---

## Data Flow

```
Customer pays →  Razorpay sends webhook  →  Server verifies signature
                                        →  Extracts email + name
                                        →  Sends eBook email via SMTP
```

---

## Deployment Options

| Platform | Command / Notes |
|---|---|
| **Railway / Render** | Connect repo, set env vars in dashboard, deploy. |
| **Heroku** | `heroku create`, `heroku config:set KEY=val`, `git push heroku main` |
| **VPS (Ubuntu)** | Run with Gunicorn behind Nginx; use `systemd` for process management. |

---

## Security Notes

- Webhook signature is verified on **every** request using `hmac.compare_digest` (constant-time, safe from timing attacks).
- Never commit your `.env` file. It is already listed in `.gitignore`.
- Use environment variables or a secrets manager in production — never hardcode credentials.
