from fastapi import APIRouter, HTTPException
from app.db import get_connection, release_connection
from app.schemas.auth import SignupRequest, LoginRequest, MessageResponse, UserResponse
import bcrypt

router = APIRouter(prefix="/auth", tags=["Auth"])

# ----------------------
# SIGNUP
# ----------------------
@router.post("/signup", response_model=MessageResponse)
def signup(data: SignupRequest):
    name = data.name
    email = data.email
    password = data.password

    # 🔹 Use fewer rounds for faster hashing (10 rounds is still secure)
    hashed_pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()

    conn = get_connection()
    cur = conn.cursor()

    try:
        cur.execute(
            "INSERT INTO employee (id, name, email, password) VALUES (%s, %s, %s, %s)",
            (email, name, email, hashed_pw)
        )
        conn.commit()
    except Exception as e:
        if "unique constraint" in str(e).lower():
            raise HTTPException(status_code=400, detail="Email already exists")
        raise HTTPException(status_code=400, detail=f"Could not create user: {e}")
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

    cur.execute("SELECT password, name FROM employee WHERE email = %s", (email,))
    row = cur.fetchone()

    cur.close()
    release_connection(conn)

    if not row:
        raise HTTPException(status_code=401, detail="Wrong email or password")

    stored_pw, name = row

    if not bcrypt.checkpw(password.encode(), stored_pw.encode()):
        raise HTTPException(status_code=401, detail="Wrong email or password")

    return {"name": name, "email": email}
