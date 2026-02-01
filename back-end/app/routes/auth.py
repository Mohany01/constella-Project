import os
from datetime import datetime, timedelta, timezone
import uuid

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from jose import jwt

from app.db import get_connection, release_connection
from app.schemas.auth import LoginRequest, MessageResponse, SignupRequest, UserResponse
from app.auth_guard import get_current_user

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_MIN = int(os.getenv("JWT_EXPIRES_MIN", 60))

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
        raise HTTPException(status_code=500, detail="JWT secret not configured")
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

# ----------------------
# SIGNUP
# ----------------------
@router.post("/signup", response_model=MessageResponse)
def signup(data: SignupRequest):
    name = data.name
    email = data.email
    password = data.password
    # DB id column is VARCHAR(20); use shortened uuid hex (no dashes)
    user_id = uuid.uuid4().hex[:20]

    # 🔐 Use fewer rounds for faster hashing (10 rounds is still secure)
    hashed_pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()

    conn = get_connection()
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
        raise HTTPException(status_code=500, detail=f"Could not create user: {e}")
    finally:
        cur.close()
        release_connection(conn)

    return {"message": "User created successfully"}

# ----------------------
# LOGIN
# ----------------------
@router.post("/login", response_model=UserResponse)
def login(data: LoginRequest):
    email = data.email
    password = data.password

    conn = get_connection()
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

    return {"id": str(user_id), "name": name, "email": email, "token": token}


# ----------------------
# CURRENT USER (protected sample)
# ----------------------
@router.get("/me")
def me(user=Depends(get_current_user)):
    """Return the current authenticated user payload."""
    return user
