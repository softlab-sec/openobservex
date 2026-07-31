"""SMTP email sender for notification channels.

Works with any SMTP provider (Gmail, SES SMTP, Mailgun SMTP, self-hosted).
Credentials come from the channel config, not global env, so each org brings
its own sender.
"""

import smtplib
from email.message import EmailMessage


def send_email(config: dict, subject: str, body: str) -> tuple[bool, str]:
    """Send one email. Returns (ok, detail). Never raises."""
    host = config.get("smtp_host")
    port = int(config.get("smtp_port", 587))
    username = config.get("username")
    password = config.get("password")
    from_addr = config.get("from_addr") or username
    to_addrs = config.get("to_addrs")
    use_tls = config.get("use_tls", True)

    if not host or not from_addr or not to_addrs:
        return False, "email channel missing smtp_host, from_addr, or to_addrs"

    if isinstance(to_addrs, str):
        to_list = [a.strip() for a in to_addrs.split(",") if a.strip()]
    else:
        to_list = list(to_addrs)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_list)
    msg.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            if use_tls:
                server.starttls()
            if username and password:
                server.login(username, password)
            server.send_message(msg)
        return True, "sent"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
