import os
from datetime import datetime, timedelta, timezone
import uuid

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import JWTError, jwt

from app.db import get_connection, release_connection
from app.schemas.auth import LoginRequest, SignupRequest, UserResponse
from app.auth_guard import get_current_user

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_MIN = int(os.getenv("JWT_EXPIRES_MIN", 60))
JWT_REFRESH_SECRET = os.getenv("JWT_REFRESH_SECRET", JWT_SECRET)
JWT_REFRESH_DAYS = int(os.getenv("JWT_REFRESH_DAYS", 7))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "").lower() in ("1", "true", "yes")

router = APIRouter(prefix="/auth", tags=["Auth"])

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

# ----------------------
# SIGNUP
# ----------------------
@router.post("/signup", response_model=UserResponse)
def signup(data: SignupRequest, response: Response):
    name = data.name
    email = data.email
    password = data.password
    # DB id column is VARCHAR(20); use shortened uuid hex (no dashes)
    user_id = uuid.uuid4().hex[:20]

    # 🔐 Use fewer rounds for faster hashing (10 rounds is still secure)
    hashed_pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()

    conn = get_connection()
    if conn is None:
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    cur = conn.cursor()

    try:
        cur.execute(
            "INSERT INTO employee (id, name, email, password) VALUES (%s, %s, %s, %s) RETURNING id",
            (user_id, name, email, hashed_pw),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
    except Exception as e:
        if "unique constraint" in str(e).lower():
            raise HTTPException(status_code=400, detail="Email already exists")
        raise HTTPException(status_code=500, detail={"code": "SERVER_ERROR"})
    finally:
        cur.close()
        release_connection(conn)

    token = create_token(user_id=str(new_id), email=email)
    refresh_token = create_refresh_token(user_id=str(new_id), email=email)
    _set_refresh_cookie(response, refresh_token)
    return {"id": str(new_id), "name": name, "email": email, "token": token}

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

    cur.execute("SELECT id, password, name FROM employee WHERE email = %s", (email,))
    row = cur.fetchone()

    cur.close()
    release_connection(conn)

    if not row:
        raise HTTPException(status_code=401, detail="Wrong email or password")

    user_id, stored_pw, name = row

    if not bcrypt.checkpw(password.encode(), stored_pw.encode()):
        raise HTTPException(status_code=401, detail="Wrong email or password")

    token = create_token(user_id=str(user_id), email=email)
    refresh_token = create_refresh_token(user_id=str(user_id), email=email)
    _set_refresh_cookie(response, refresh_token)

    return {"id": str(user_id), "name": name, "email": email, "token": token}


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
