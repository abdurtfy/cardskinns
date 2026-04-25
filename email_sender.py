import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

SMTP_SERVER   = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")

EBOOK_DRIVE_LINK    = os.environ.get("EBOOK_DRIVE_LINK", "https://drive.google.com/your-ebook-link")
EMAIL_SUBJECT       = os.environ.get("EMAIL_SUBJECT", "Your eBook is here! 📚")
EMAIL_BODY_TEMPLATE = os.environ.get(
    "EMAIL_BODY_TEMPLATE",
    (
        "Hi {name},\n\n"
        "Thank you for your purchase! We're thrilled to have you as a reader.\n\n"
        "Here is your eBook download link:\n"
        "{link}\n\n"
        "If you have any issues accessing the link, please reply to this email.\n\n"
        "Happy reading!\n"
        "The Team"
    )
)


def send_ebook_email(name: str, email: str) -> None:
    """
    Compose and send a plain-text email containing the eBook link.

    Args:
        name:  Recipient's name (from Razorpay payment notes).
        email: Recipient's email address (from Razorpay payment entity).

    Raises:
        smtplib.SMTPException: On any SMTP-level failure.
        ValueError: If required config env vars are missing.
    """
    if not SMTP_USER or not SMTP_PASSWORD:
        raise ValueError(
            "SMTP_USER and SMTP_PASSWORD must be set in environment variables."
        )

    body = EMAIL_BODY_TEMPLATE.format(name=name, link=EBOOK_DRIVE_LINK)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = EMAIL_SUBJECT
    msg["From"]    = SMTP_USER
    msg["To"]      = email

    msg.attach(MIMEText(body, "plain"))

    logger.info(f"Connecting to SMTP server {SMTP_SERVER}:{SMTP_PORT}")

    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, email, msg.as_string())

    logger.info(f"Email delivered to {email}")
