from typing import Dict, List
from pydantic import BaseModel, EmailStr, constr

# ----------------------
# Request Schemas
# ----------------------
class SignupStartRequest(BaseModel):
    name: constr(min_length=1, max_length=50)
    email: EmailStr
    password: constr(min_length=6, max_length=128)

    class Config:
        extra = "ignore"  # ignore any additional frontend fields

class SignupVerifyRequest(BaseModel):
    verification_id: str
    code: constr(min_length=6, max_length=6)

class LoginRequest(BaseModel):
    email: EmailStr
    password: constr(min_length=6, max_length=128)

class PasswordChangeStartRequest(BaseModel):
    new_password: constr(min_length=6, max_length=128)

class PasswordChangeVerifyRequest(BaseModel):
    verification_id: str
    code: constr(min_length=6, max_length=6)

# ----------------------
# Response Schemas
# ----------------------
class MessageResponse(BaseModel):
    message: str

class SignupStartResponse(BaseModel):
    verification_id: str
    message: str
    resend_cooldown_seconds: int

class UserResponse(BaseModel):
    id: str
    name: str
    email: EmailStr
    token: str

class ProfileResponse(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    department: str
    skills_by_category: Dict[str, List[str]]
