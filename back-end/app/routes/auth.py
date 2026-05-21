import os
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import random
import secrets
import smtplib
import threading
import uuid
from email.message import EmailMessage

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import JWTError, jwt

from app.db import get_connection, release_connection
from app.permissions import fetch_current_employee
from app.schemas.auth import (
    LoginRequest,
    MessageResponse,
    PasswordChangeStartRequest,
    PasswordChangeVerifyRequest,
    ProfileResponse,
    SignupStartRequest,
    SignupStartResponse,
    SignupVerifyRequest,
    UserResponse,
)
from app.auth_guard import get_current_user

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_MIN = int(os.getenv("JWT_EXPIRES_MIN", 60))
JWT_REFRESH_SECRET = os.getenv("JWT_REFRESH_SECRET", JWT_SECRET)
JWT_REFRESH_DAYS = int(os.getenv("JWT_REFRESH_DAYS", 7))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "").lower() in ("1", "true", "yes")
VERIFICATION_CODE_EXP_MIN = int(os.getenv("VERIFICATION_CODE_EXP_MIN", 10))
VERIFICATION_MAX_ATTEMPTS = 5
VERIFICATION_RESEND_COOLDOWN_SEC = max(
    30,
    min(60, int(os.getenv("VERIFICATION_RESEND_COOLDOWN_SEC", 45))),
)
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME)
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")

router = APIRouter(prefix="/auth", tags=["Auth"])
pending_signups = {}
pending_signups_lock = threading.Lock()
pending_password_changes = {}
pending_password_changes_lock = threading.Lock()


def create_token(user_id: str, email: str):
    """Generate a signed JWT for the authenticated user."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=JWT_EXPIRES_MIN)).timestamp()),
    }
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, email: str):
    """Generate a signed refresh JWT stored in HttpOnly cookie."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=JWT_REFRESH_DAYS)).timestamp()),
    }
    if not JWT_REFRESH_SECRET:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    return jwt.encode(payload, JWT_REFRESH_SECRET, algorithm=JWT_ALGORITHM)


def _get_table_columns(cur, table_name: str) -> set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table_name,),
    )
    return {row[0] for row in cur.fetchall()}


def _get_employee_skill_employee_column(employee_skill_columns: set[str]) -> str:
    for column in ("employee_id", "emp_id", "id"):
        if column in employee_skill_columns:
            return column
    raise HTTPException(
        status_code=500,
        detail="Employee skill table has no supported employee id column.",
    )


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=JWT_REFRESH_DAYS * 24 * 60 * 60,
        path="/",
    )


def _send_verification_email(to_email: str, code: str) -> None:
    if not SMTP_HOST or not SMTP_FROM_EMAIL:
        raise HTTPException(status_code=500, detail="SMTP is not configured.")

    msg = EmailMessage()
    msg["Subject"] = "Constella | Verify your email"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = to_email
    msg.set_content(
        "Constella Email Verification\n\n"
        f"Use this verification code to complete your signup: {code}\n\n"
        f"This code expires in {VERIFICATION_CODE_EXP_MIN} minutes.\n\n"
        "If you did not request this, you can safely ignore this email.\n\n"
        "Constella Team"
    )
    msg.add_alternative(
        f"""
        <!doctype html>
        <html>
          <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
                    <tr>
                      <td style="padding:24px 24px 8px 24px;">
                        <p style="margin:0;color:#6b7280;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Constella</p>
                        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.3;color:#111827;">Verify your email address</h1>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:16px 24px 0 24px;">
                        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">
                          Use the verification code below to complete your signup.
                        </p>
                        <div style="margin:0 0 16px 0;padding:14px 18px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;text-align:center;">
                          <span style="display:inline-block;font-size:32px;letter-spacing:6px;font-weight:700;color:#111827;">{code}</span>
                        </div>
                        <p style="margin:0 0 8px 0;font-size:14px;color:#4b5563;">
                          This code will expire in <strong>{VERIFICATION_CODE_EXP_MIN} minutes</strong>.
                        </p>
                        <p style="margin:0 0 20px 0;font-size:14px;color:#6b7280;">
                          If you did not request this, you can safely ignore this email.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:14px 24px 22px 24px;border-top:1px solid #f3f4f6;">
                        <p style="margin:0;font-size:13px;color:#6b7280;">Constella Team</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
        """,
        subtype="html",
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            if SMTP_USE_TLS:
                server.starttls()
            if SMTP_USERNAME and SMTP_PASSWORD:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to send verification email. Please try again.",
        )


def _send_password_change_email(to_email: str, code: str) -> None:
    if not SMTP_HOST or not SMTP_FROM_EMAIL:
        raise HTTPException(status_code=500, detail="SMTP is not configured.")

    msg = EmailMessage()
    msg["Subject"] = "Constella | Password change verification"
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = to_email
    msg.set_content(
        "Constella Password Change Verification\n\n"
        f"Use this verification code to change your password: {code}\n\n"
        f"This code expires in {VERIFICATION_CODE_EXP_MIN} minutes.\n\n"
        "If you did not request this, you can safely ignore this email.\n\n"
        "Constella Team"
    )
    msg.add_alternative(
        f"""
        <!doctype html>
        <html>
          <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
                    <tr>
                      <td style="padding:24px 24px 8px 24px;">
                        <p style="margin:0;color:#6b7280;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Constella</p>
                        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.3;color:#111827;">Confirm your password change</h1>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:16px 24px 0 24px;">
                        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">
                          Use this code to verify your password update.
                        </p>
                        <div style="margin:0 0 16px 0;padding:14px 18px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;text-align:center;">
                          <span style="display:inline-block;font-size:32px;letter-spacing:6px;font-weight:700;color:#111827;">{code}</span>
                        </div>
                        <p style="margin:0 0 8px 0;font-size:14px;color:#4b5563;">
                          This code expires in <strong>{VERIFICATION_CODE_EXP_MIN} minutes</strong>.
                        </p>
                        <p style="margin:0 0 20px 0;font-size:14px;color:#6b7280;">
                          If this wasn't you, ignore this email and keep your account secure.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:14px 24px 22px 24px;border-top:1px solid #f3f4f6;">
                        <p style="margin:0;font-size:13px;color:#6b7280;">Constella Team</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
        """,
        subtype="html",
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            if SMTP_USE_TLS:
                server.starttls()
            if SMTP_USERNAME and SMTP_PASSWORD:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to send verification email. Please try again.",
        )


def _hash_verification_code(code: str, salt: str) -> str:
    return hashlib.sha256(f"{code}:{salt}".encode()).hexdigest()


def _create_user(name: str, email: str, password: str, password_is_hashed: bool = False) -> str:
    hashed_pw = password if password_is_hashed else bcrypt.hashpw(
        password.encode(),
        bcrypt.gensalt(rounds=10),
    ).decode()

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        cur.execute(
            """
            INSERT INTO employee (full_name, email, password)
            VALUES (%s, %s, %s)
            RETURNING employee_id
            """,
            (name, email, hashed_pw),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        return str(new_id)
    except Exception as e:
        if "unique constraint" in str(e).lower():
            raise HTTPException(status_code=400, detail="Email already exists")
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    finally:
        cur.close()
        release_connection(conn)


def _set_existing_user_password(user_id: str, name: str, password: str, password_is_hashed: bool = False) -> str:
    hashed_pw = password if password_is_hashed else bcrypt.hashpw(
        password.encode(),
        bcrypt.gensalt(rounds=10),
    ).decode()

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        cur.execute(
            """
            UPDATE employee
            SET full_name = %s, password = %s
            WHERE employee_id::text = %s AND (password IS NULL OR password = '')
            RETURNING employee_id
            """,
            (name, hashed_pw, user_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="Email already exists")
        conn.commit()
        return str(row[0])
    finally:
        cur.close()
        release_connection(conn)


def _find_user_by_email(email: str):
    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT employee_id, password
            FROM employee
            WHERE LOWER(TRIM(email)) = LOWER(TRIM(%s))
            ORDER BY
                CASE
                    WHEN password IS NULL OR BTRIM(password) = '' THEN 0
                    ELSE 1
                END,
                employee_id
            LIMIT 1
            """,
            (email,),
        )
        return cur.fetchone()
    finally:
        cur.close()
        release_connection(conn)


# ----------------------
# SIGNUP START (send code)
# ----------------------
@router.post("/signup/start", response_model=SignupStartResponse)
def signup_start(data: SignupStartRequest):
    name = data.name.strip()
    email = data.email.strip().lower()
    password = data.password
    hashed_pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()

    existing_user_id = None
    existing = _find_user_by_email(email)
    if not existing:
        raise HTTPException(status_code=400, detail="Email is not registered.")

    existing_user_id = str(existing[0])
    existing_password = existing[1]
    if existing_password is not None and str(existing_password).strip() != "":
        raise HTTPException(status_code=400, detail="Email already exists")

    now = datetime.now(timezone.utc)
    verification_id = uuid.uuid4().hex
    code = f"{random.randint(0, 999999):06d}"
    otp_salt = secrets.token_hex(16)
    expires_at = now + timedelta(minutes=VERIFICATION_CODE_EXP_MIN)
    existing_payload = None

    with pending_signups_lock:
        expired_ids = [
            sid
            for sid, payload in pending_signups.items()
            if now > payload["expires_at"]
        ]
        for sid in expired_ids:
            pending_signups.pop(sid, None)

        for sid, payload in pending_signups.items():
            if payload["email"] == email:
                existing_payload = payload
                verification_id = sid
                break

        if existing_payload:
            since_last_sent = int((now - existing_payload["last_sent_at"]).total_seconds())
            if since_last_sent < VERIFICATION_RESEND_COOLDOWN_SEC:
                retry_after = VERIFICATION_RESEND_COOLDOWN_SEC - since_last_sent
                raise HTTPException(
                    status_code=429,
                    detail=f"Please wait {retry_after} seconds before requesting a new code.",
                )

        pending_signups[verification_id] = {
            "name": name,
            "email": email,
            "password": hashed_pw,
            "existing_user_id": existing_user_id,
            "otp_salt": otp_salt,
            "otp_hash": _hash_verification_code(code, otp_salt),
            "attempts": 0,
            "max_attempts": VERIFICATION_MAX_ATTEMPTS,
            "expires_at": expires_at,
            "last_sent_at": now,
        }

    try:
        _send_verification_email(to_email=email, code=code)
    except HTTPException:
        with pending_signups_lock:
            pending_signups.pop(verification_id, None)
        raise

    return {
        "verification_id": verification_id,
        "message": "Verification code sent to your email.",
        "resend_cooldown_seconds": VERIFICATION_RESEND_COOLDOWN_SEC,
    }


# ----------------------
# SIGNUP VERIFY (complete signup)
# ----------------------
@router.post("/signup/verify", response_model=UserResponse)
def signup_verify(data: SignupVerifyRequest, response: Response):
    verification_id = (data.verification_id or "").strip()
    code = (data.code or "").strip()
    now = datetime.now(timezone.utc)

    with pending_signups_lock:
        payload = pending_signups.get(verification_id)

    if not payload:
        raise HTTPException(status_code=400, detail="Verification request not found.")
    if now > payload["expires_at"]:
        with pending_signups_lock:
            pending_signups.pop(verification_id, None)
        raise HTTPException(status_code=400, detail="Verification code has expired.")
    provided_hash = _hash_verification_code(code, payload["otp_salt"])
    if not hmac.compare_digest(provided_hash, payload["otp_hash"]):
        with pending_signups_lock:
            current = pending_signups.get(verification_id)
            if not current:
                raise HTTPException(status_code=400, detail="Verification request not found.")
            current["attempts"] += 1
            attempts_left = current["max_attempts"] - current["attempts"]
            if current["attempts"] >= current["max_attempts"]:
                pending_signups.pop(verification_id, None)
                raise HTTPException(
                    status_code=400,
                    detail="Too many attempts. Please request a new code.",
                )

        raise HTTPException(
            status_code=400,
            detail=f"Wrong verification code. {attempts_left} attempts left.",
        )

    if payload.get("existing_user_id"):
        # Strict path: complete signup on the exact pre-existing row only.
        new_id = _set_existing_user_password(
            user_id=str(payload["existing_user_id"]),
            name=payload["name"],
            password=payload["password"],
            password_is_hashed=True,
        )
    else:
        new_id = _create_user(
            name=payload["name"],
            email=payload["email"],
            password=payload["password"],
            password_is_hashed=True,
        )

    with pending_signups_lock:
        pending_signups.pop(verification_id, None)

    token = create_token(user_id=new_id, email=payload["email"])
    refresh_token = create_refresh_token(user_id=new_id, email=payload["email"])
    _set_refresh_cookie(response, refresh_token)

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()
    try:
        employee = fetch_current_employee(
            cur,
            {"id": new_id, "email": payload["email"]},
        )
    finally:
        cur.close()
        release_connection(conn)

    return {
        "id": new_id,
        "name": payload["name"],
        "email": payload["email"],
        "role": employee.get("role") or "",
        "token": token,
    }


@router.post("/password-change/start", response_model=SignupStartResponse)
def password_change_start(
    data: PasswordChangeStartRequest,
    user=Depends(get_current_user),
):
    email = (user.get("email") or "").strip().lower()
    user_id = str(user.get("id") or "")
    if not email or not user_id:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    hashed_pw = bcrypt.hashpw(data.new_password.encode(), bcrypt.gensalt(rounds=10)).decode()
    now = datetime.now(timezone.utc)
    verification_id = uuid.uuid4().hex
    code = f"{random.randint(0, 999999):06d}"
    otp_salt = secrets.token_hex(16)
    expires_at = now + timedelta(minutes=VERIFICATION_CODE_EXP_MIN)
    existing_payload = None

    with pending_password_changes_lock:
        expired_ids = [
            sid
            for sid, payload in pending_password_changes.items()
            if now > payload["expires_at"]
        ]
        for sid in expired_ids:
            pending_password_changes.pop(sid, None)

        for sid, payload in pending_password_changes.items():
            if payload["user_id"] == user_id:
                existing_payload = payload
                verification_id = sid
                break

        if existing_payload:
            since_last_sent = int((now - existing_payload["last_sent_at"]).total_seconds())
            if since_last_sent < VERIFICATION_RESEND_COOLDOWN_SEC:
                retry_after = VERIFICATION_RESEND_COOLDOWN_SEC - since_last_sent
                raise HTTPException(
                    status_code=429,
                    detail=f"Please wait {retry_after} seconds before requesting a new code.",
                )

        pending_password_changes[verification_id] = {
            "user_id": user_id,
            "email": email,
            "new_password": hashed_pw,
            "otp_salt": otp_salt,
            "otp_hash": _hash_verification_code(code, otp_salt),
            "attempts": 0,
            "max_attempts": VERIFICATION_MAX_ATTEMPTS,
            "expires_at": expires_at,
            "last_sent_at": now,
        }

    try:
        _send_password_change_email(to_email=email, code=code)
    except HTTPException:
        with pending_password_changes_lock:
            pending_password_changes.pop(verification_id, None)
        raise

    return {
        "verification_id": verification_id,
        "message": "Verification code sent to your email.",
        "resend_cooldown_seconds": VERIFICATION_RESEND_COOLDOWN_SEC,
    }


@router.post("/password-change/verify", response_model=MessageResponse)
def password_change_verify(
    data: PasswordChangeVerifyRequest,
    user=Depends(get_current_user),
):
    verification_id = (data.verification_id or "").strip()
    code = (data.code or "").strip()
    user_id = str(user.get("id") or "")
    now = datetime.now(timezone.utc)

    with pending_password_changes_lock:
        payload = pending_password_changes.get(verification_id)

    if not payload:
        raise HTTPException(status_code=400, detail="Verification request not found.")
    if payload.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Invalid verification request.")
    if now > payload["expires_at"]:
        with pending_password_changes_lock:
            pending_password_changes.pop(verification_id, None)
        raise HTTPException(status_code=400, detail="Verification code has expired.")

    provided_hash = _hash_verification_code(code, payload["otp_salt"])
    if not hmac.compare_digest(provided_hash, payload["otp_hash"]):
        with pending_password_changes_lock:
            current = pending_password_changes.get(verification_id)
            if not current:
                raise HTTPException(status_code=400, detail="Verification request not found.")
            current["attempts"] += 1
            attempts_left = current["max_attempts"] - current["attempts"]
            if current["attempts"] >= current["max_attempts"]:
                pending_password_changes.pop(verification_id, None)
                raise HTTPException(
                    status_code=400,
                    detail="Too many attempts. Please request a new code.",
                )

        raise HTTPException(
            status_code=400,
            detail=f"Wrong verification code. {attempts_left} attempts left.",
        )

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE employee SET password = %s WHERE employee_id::text = %s",
            (payload["new_password"], user_id),
        )
        conn.commit()
    finally:
        cur.close()
        release_connection(conn)

    with pending_password_changes_lock:
        pending_password_changes.pop(verification_id, None)

    return {"message": "Password updated successfully."}


# ----------------------
# LOGIN
# ----------------------
@router.post("/login", response_model=UserResponse)
def login(data: LoginRequest, response: Response):
    email = data.email
    password = data.password

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        cur.execute(
            """
            SELECT employee_id, password, full_name
            FROM employee
            WHERE LOWER(TRIM(email)) = LOWER(TRIM(%s))
            LIMIT 1
            """,
            (email,),
        )
        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=401, detail="Wrong username or password")

        user_id, stored_pw, name = row

        if not bcrypt.checkpw(password.encode(), stored_pw.encode()):
            raise HTTPException(status_code=401, detail="Wrong username or password")

        token = create_token(user_id=str(user_id), email=email)
        refresh_token = create_refresh_token(user_id=str(user_id), email=email)
        _set_refresh_cookie(response, refresh_token)
        employee = fetch_current_employee(cur, {"id": str(user_id), "email": email})
    finally:
        cur.close()
        release_connection(conn)

    return {
        "id": str(user_id),
        "name": name,
        "email": email,
        "role": employee.get("role") or "",
        "token": token,
    }


# ----------------------
# REFRESH (uses HttpOnly refresh_token cookie)
# ----------------------
@router.post("/refresh")
def refresh(request: Request):
    if not JWT_REFRESH_SECRET:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})

    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    try:
        payload = jwt.decode(token, JWT_REFRESH_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    user_id = payload.get("sub")
    email = payload.get("email")
    if not user_id or not email:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})

    access_token = create_token(user_id=str(user_id), email=email)
    return {"access_token": access_token, "token_type": "bearer"}


# ----------------------
# CURRENT USER (protected sample)
# ----------------------
@router.get("/me")
def me(user=Depends(get_current_user)):
    """Return the current authenticated user payload."""
    return user


@router.get("/profile", response_model=ProfileResponse)
def get_profile(user=Depends(get_current_user)):
    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()
    try:
        employee = fetch_current_employee(cur, user)

        employee_skill_employee_col = _get_employee_skill_employee_column(
            _get_table_columns(cur, "employee_skill")
        )
        cur.execute(
            f"""
            SELECT
              s.skill_name,
              COALESCE(NULLIF(BTRIM(s.category::text), ''), 'uncategorized') AS category
            FROM employee_skill es
            JOIN skill s ON s.skill_id = es.skill_id
            WHERE es.{employee_skill_employee_col}::text = %s
            ORDER BY category, s.skill_name
            """,
            (user["id"],),
        )
        skill_rows = cur.fetchall()

        skills_by_category = {
            "hard_skill": [],
            "soft_skill": [],
            "tool_tech": [],
            "language": [],
        }
        for skill_name, category in skill_rows:
            if not skill_name:
                continue
            key = category if category else "uncategorized"
            skills_by_category.setdefault(key, [])
            skills_by_category[key].append(skill_name)

        for key in list(skills_by_category.keys()):
            skills_by_category[key] = sorted(set(skills_by_category[key]))

        return {
            "id": employee.get("employee_id") or employee.get("id") or "",
            "name": employee.get("name") or "",
            "email": employee.get("email") or "",
            "role": employee.get("role") or "Employee",
            "department": employee.get("department_id") or "General",
            "skills_by_category": skills_by_category,
        }
    finally:
        cur.close()
        release_connection(conn)
